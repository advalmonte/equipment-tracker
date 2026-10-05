exports.handler = async function (event) {
  const TOKEN = process.env.AIRTABLE_TOKEN;
  const BASE_ID = process.env.AIRTABLE_BASE_ID;
  const TABLE_NAME = "Equipment";
  const authHeader = { Authorization: `Bearer ${TOKEN}` };
  const params = event.queryStringParameters || {};

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

    if (event.httpMethod === "PATCH") {
      const body = JSON.parse(event.body);
      const response = await fetch(url, {
        method: "PATCH",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ fields: body.fields }),
      });
      const data = await response.json();
      return { statusCode: response.status, body: JSON.stringify(data) };
    }

    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
