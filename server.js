// server.js
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const OpenAI = require("openai");

const app = express();

// Autorise les appels depuis Systeme.io (et autres)
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "2mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Page de test Render
app.get("/", (req, res) => {
  res.send("OK - serveur de correction Talamize actif");
});

// --- Fonction: correction "comme moi" (STRICT voyelles obligatoires) ---
async function correctHandwritingArabic(imageBuffer, expectedList) {
  const base64 = imageBuffer.toString("base64");
  const dataUrl = `data:image/jpeg;base64,${base64}`;

  const prompt = `
Tu es un correcteur STRICT d'écriture arabe (avec voyelles).

On te donne une photo d'écriture manuscrite + une liste de phrases attendues.
Tu dois rendre une correction SIMPLE, phrase par phrase.

RÈGLES STRICTES :
- Base-toi uniquement sur ce que tu VOIS sur la feuille. Ne devine pas.
- Si la phrase n'apparaît pas sur la photo => ok:false et note:"Manquant"
- Si les LETTRES (sans voyelles) sont incorrectes => ok:false et note:"Mot incorrect"
- Si les lettres sont correctes MAIS que les voyelles (harakāt/tanwīn/sukūn/ٰ) sont absentes ou incomplètes => ok:false et note:"Voyelles manquantes"
- Si les lettres + voyelles sont présentes mais pas exactement correctes => ok:false et note:"Voyelles à corriger"
- Si tout est correct => ok:true et note:""
- Les notes doivent être COURTES (pas d'explication longue).

Tu dois renvoyer un JSON STRICT au format EXACT :
{
  "items": [
    { "ok": true/false, "expected": "PHRASE_ATTENDUE", "note": "" },
    ...
  ]
}

IMPORTANT :
- Tu dois renvoyer exactement les mêmes "expected" dans le même ordre que la liste fournie.
- Ne renvoie RIEN d'autre que ce JSON.
`;

  // Appel OpenAI (mode JSON strict)
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
              expectedList.map((s, i) => `${i + 1}. ${s}`).join("\n"),
          },
          { type: "input_image", image_url: dataUrl },
        ],
      },
    ],
    text: { format: { type: "json_object" } },
    temperature: 0,
  });

  const raw = response.output_text || "{}";

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // Si jamais le JSON sort mal, on renvoie tout en "Manquant"
    return expectedList.map((exp) => ({ ok: false, expected: exp, note: "Manquant" }));
  }

  const items = Array.isArray(parsed.items) ? parsed.items : [];

  // Sécurise l'ordre et les expected
  const mapByExpected = new Map(items.map((it) => [it.expected, it]));

  return expectedList.map((exp) => {
    const it = mapByExpected.get(exp);
    if (!it) return { ok: false, expected: exp, note: "Manquant" };

    return {
      ok: it.ok === true,
      expected: exp,
      note: typeof it.note === "string" ? it.note : "",
    };
  });
}

// --- API appelée par Systeme.io ---
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
