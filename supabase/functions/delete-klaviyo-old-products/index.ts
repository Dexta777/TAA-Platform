import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const KLAVIYO_API_KEY = Deno.env.get("KLAVIYO_PRIVATE_API_KEY") || "";
const REVISION = "2026-04-15";

const ids = [
  "$custom:::$default:::67546dff0fd2f454e6dda686",
  "$custom:::$default:::67546e417ef76091a2b7de8c",
  "$custom:::$default:::660eb859826a01a617092f4e",
  "$custom:::$default:::663b31e4514dced3ce69193c",
  "$custom:::$default:::663b3229af21191a6f2c3340",
  "$custom:::$default:::663b32f555f0340a670f5219",
  "$custom:::$default:::663b33e08fdb02804ee64197",
  "$custom:::$default:::6668295ddc40c879c10fc218",
  "$custom:::$default:::66682f0ea7834a9e5fe9c76c"
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!KLAVIYO_API_KEY) {
      throw new Error("Missing KLAVIYO_PRIVATE_API_KEY.");
    }

    const results = [];

    for (const id of ids) {
      const response = await fetch(
        `https://a.klaviyo.com/api/catalog-items/${encodeURIComponent(id)}`,
        {
          method: "DELETE",
          headers: {
            "Authorization": `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
            "Accept": "application/json",
            "revision": REVISION,
          },
        }
      );

      results.push({
        id,
        status: response.status,
        ok: response.ok,
        body: await response.text(),
      });
    }

    return new Response(
      JSON.stringify({ ok: true, results }, null, 2),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: error.message || "Delete failed.",
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});