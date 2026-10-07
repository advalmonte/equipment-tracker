const crypto = require("crypto");

// Compares two strings without leaking timing information
function sameSecret(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// TEAM_EMAILS in Netlify looks like: {"A. Valmonte":"a@x.com","G. Cruz":"g@x.com"}
function readTeam() {
  try {
    const t = JSON.parse(process.env.TEAM_EMAILS || "{}");
    return t && typeof t === "object" ? t : {};
  } catch (e) {
    return {};
  }
}

// Builds the fields that hand ownership to the editor and flag the old owner for an email
function ownershipFields(record, editorEmail) {
  const old = record && record.fields && record.fields["Entry Created By"];
  const fields = { "Entry Created By": { email: editorEmail } };
  const ownerChanged =
    old && old.id && old.email && old.email.toLowerCase() !== editorEmail.toLowerCase();
  if (ownerChanged) {
    fields["Previous Owner"] = { id: old.id };
    fields["Edit Notice Stamp"] = new Date().toISOString();
  }
  return fields;
}

exports.handler = async function (event) {
  const TOKEN = process.env.AIRTABLE_TOKEN;
  const BASE_ID = process.env.AIRTABLE_BASE_ID;
  const TEAM_PASSWORD = process.env.TEAM_PASSWORD;
  const TABLE_NAME = "Equipment";
  const authHeader = { Authorization: `Bearer ${TOKEN}` };
  const params = event.queryStringParameters || {};
  const headers = event.headers || {};

  // Team password check. Refuses everything if no password has been set.
  if (!TEAM_PASSWORD) {
    return { statusCode: 500, body: JSON.stringify({ error: "TEAM_PASSWORD is not set in Netlify" }) };
  }
  if (!sameSecret(headers["x-team-password"] || "", TEAM_PASSWORD)) {
    return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  const team = readTeam();

  // List of team names for the "Who are you?" screen
  if (params.team) {
    return { statusCode: 200, body: JSON.stringify(Object.keys(team)) };
  }

  // Who is making this change (only needed for edits and photo uploads)
  let editorName = "";
  try {
    editorName = decodeURIComponent(headers["x-editor-name"] || "");
  } catch (e) {
    editorName = "";
  }
  const editorEmail = team[editorName];
  const isWrite = event.httpMethod === "PATCH" || event.httpMethod === "POST";
  if (isWrite && !editorEmail) {
    return { statusCode: 403, body: JSON.stringify({ error: "Unknown editor" }) };
  }

  try {
    // Dropdown options request
    if (params.schema) {
      const r = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, { headers: authHeader });
      const data = await r.json();
      if (!r.ok) return { statusCode: r.status, body: JSON.stringify(data) };
      const table = (data.tables || []).find((t) => t.name === TABLE_NAME);
      const options = {};
      if (table) {
        table.fields.forEach((f) => {
          if (f.options && f.options.choices) {
            options[f.name] = f.options.choices.map((c) => c.name);
          }
        });
      }
      return { statusCode: 200, body: JSON.stringify(options) };
    }

    const recordId = params.id;
    if (!recordId) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing record id" }) };
    }
    const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_NAME}/${recordId}`;

    if (event.httpMethod === "GET") {
      const response = await fetch(url, { headers: authHeader });
      const data = await response.json();
      return { statusCode: response.status, body: JSON.stringify(data) };
    }

    // Edit: save the changes and make the editor the new owner
    if (event.httpMethod === "PATCH") {
      const body = JSON.parse(event.body);

      const curRes = await fetch(url, { headers: authHeader });
      const cur = await curRes.json();
      if (!curRes.ok) return { statusCode: curRes.status, body: JSON.stringify(cur) };

      const fields = Object.assign({}, body.fields, ownershipFields(cur, editorEmail));
      const response = await fetch(url, {
        method: "PATCH",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      const data = await response.json();
      return { statusCode: response.status, body: JSON.stringify(data) };
    }

    // Photo upload: add the new photo, keep only the newest one, and update ownership
    if (event.httpMethod === "POST") {
      const { filename, contentType, file } = JSON.parse(event.body);

      // 1. Note which photos exist (and who owns the item) before the upload
      const beforeRes = await fetch(url, { headers: authHeader });
      const before = await beforeRes.json();
      if (!beforeRes.ok) return { statusCode: beforeRes.status, body: JSON.stringify(before) };
      const oldIds = ((before.fields && before.fields.Photo) || []).map((p) => p.id);

      // 2. Upload the new photo
      const up = await fetch(
        `https://content.airtable.com/v0/${BASE_ID}/${recordId}/Photo/uploadAttachment`,
        {
          method: "POST",
          headers: { ...authHeader, "Content-Type": "application/json" },
          body: JSON.stringify({ contentType, file, filename }),
        }
      );
      const upData = await up.json();
      if (!up.ok) return { statusCode: up.status, body: JSON.stringify(upData) };

      // 3. Re-read the record so we see exactly what Airtable now holds
      const afterRes = await fetch(url, { headers: authHeader });
      const after = await afterRes.json();
      const photos = (after.fields && after.fields.Photo) || [];
      const fresh = photos.filter((p) => !oldIds.includes(p.id));

      // 4. One final update: drop older photos if needed, and hand ownership to the editor
      const fields = ownershipFields(before, editorEmail);
      if (fresh.length > 0 && photos.length > fresh.length) {
        fields.Photo = [{ id: fresh[fresh.length - 1].id }];
      }
      const r = await fetch(url, {
        method: "PATCH",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      const d = await r.json();
      return { statusCode: r.status, body: JSON.stringify(d) };
    }

    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
