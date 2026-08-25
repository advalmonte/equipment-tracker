exports.handler = async function (event) {
  const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
  const BASE_ID = process.env.AIRTABLE_BASE_ID;
  const TABLE_NAME = "Equipment";

  const recordId = event.queryStringParameters.id;

  if (!recordId) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing record id" }) };
  }

  const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_NAME}/${recordId}`;

  try {
    if (event.httpMethod === "GET") {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
      });
      const data = await response.json();
      return { statusCode: response.status, body: JSON.stringify(data) };
    }

    if (event.httpMethod === "PATCH") {
      const body = JSON.parse(event.body);
      const response = await fetch(url, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`,
          "Content-Type": "application/json",
        },
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
