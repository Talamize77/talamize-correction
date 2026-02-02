const express = require("express");
const cors = require("cors");
const multer = require("multer");
const OpenAI = require("openai");

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "2mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 } // 8 MB
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.get("/", (req, res) => {
  res.send("OK - Talamize correction server running");
});

async function correctHandwritingArabic(imageBuffer, expectedList) {
  const base64 = imageBuffer.toString("base64");
  const dataUrl = `data:image/jpeg;base64,${base64}`;

  const prompt = `
Tu es un correcteur STRICT d'écriture arabe (VOYELLES OBLIGATOIRES).

Tu reçois:
- une photo d'écriture manuscrite
- une liste de phrases attendues (avec voyelles)

Ta mission:
- Pour CHAQUE phrase attendue, dire si l'élève l'a écrite correctement.
- Si les lettres sont correctes mais que les voyelles sont absentes/incomplètes => ERREUR.

RÈGLES STRICTES (anti-triche):
- Base-toi uniquement sur ce que tu VOIS sur la feuille. Ne devine pas.
- N'invente pas des voyelles.
- Si la phrase n'est pas visible => note "Manquant".
- Notes COURTES uniquement.

Format JSON STRICT:
{
  "items": [
    { "ok": true/false, "expected": "PHRASE_ATTENDUE", "note": "" }
  ]
}

Notes autorisées (uniquement):
- "" (si OK)
- "Mot incorrect"
- "Voyelles manquantes"
- "Voyelles à corriger"
- "Manquant"

IMPORTANT:
- "expected" doit être EXACTEMENT la phrase attendue, et dans le même ordre.
- Ne renvoie RIEN d'autre que le JSON.
`;

  const response = await openai.responses.create({
    model: "gpt-5.2",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              prompt +
              "\n\nListe attendue:\n" +
              expectedList.map((s, i) => `${i + 1}. ${s}`).join("\n")
          },
          { type: "input_image", image_url: dataUrl }
        ]
      }
    ],
    text: { format: { type: "json_object" } },
    temperature: 0
  });

  const raw = response.output_text || "{}";

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return expectedList.map(exp => ({ ok: false, expected: exp, note: "Manquant" }));
  }

  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const mapByExpected = new Map(items.map(it => [it.expected, it]));

  return expectedList.map(exp => {
    const it = mapByExpected.get(exp);
    if (!it) return { ok: false, expected: exp, note: "Manquant" };

    // sécurité sur note
    const allowed = new Set(["", "Mot incorrect", "Voyelles manquantes", "Voyelles à corriger", "Manquant"]);
    const note = typeof it.note === "string" && allowed.has(it.note) ? it.note : "Manquant";

    return {
      ok: it.ok === true && note === "",
      expected: exp,
      note
    };
  });
}

app.post("/api/correct-handwriting", upload.single("image"), async (req, res) => {
  try {
    const expected = JSON.parse(req.body.expected || "[]");

    if (!req.file || !Array.isArray(expected) || expected.length === 0) {
      return res.status(400).json({ error: "Données manquantes" });
    }

    const items = await correctHandwritingArabic(req.file.buffer, expected);
    return res.json({ items });
  } catch (e) {
    return res.status(500).json({ error: "Erreur serveur" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Serveur lancé sur le port", PORT));
