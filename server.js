import express from "express";
import multer from "multer";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(cors());

const upload = multer({ limits: { fileSize: 6 * 1024 * 1024 } }); // 6MB
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// -------- OUTILS SIMPLES --------
function stripSpaces(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function shortNote(expected, got) {
  if (!got) return "Photo illisible ou texte manquant";

  const harakat = /[\u064B-\u0652\u0670]/g;
  const baseExpected = expected.replace(harakat, "");
  const baseGot = got.replace(harakat, "");

  if (stripSpaces(baseExpected) === stripSpaces(baseGot) && stripSpaces(expected) !== stripSpaces(got)) {
    if (/[ًٌٍ]/.test(expected) && !/[ًٌٍ]/.test(got)) return "Il manque le tanwīn (ٌ)";
    if (/ِ/.test(expected) && !/ِ/.test(got)) return "Il manque la kasra (ِ)";
    if (/ُ/.test(expected) && !/ُ/.test(got)) return "Il manque la ḍamma (ُ)";
    if (/َ/.test(expected) && !/َ/.test(got)) return "Il manque la fatḥa (َ)";
    if (/ْ/.test(expected) && !/ْ/.test(got)) return "Il manque le sukūn (ْ)";
    if (/\u0670/.test(expected) && !/\u0670/.test(got)) return "Il manque le petit alif (ٰ)";
    return "Voyelles à corriger";
  }

  return "Mot incorrect";
}

// -------- LECTURE MANUSCRITE VIA OPENAI --------
async function readHandwritingArabic(imageBuffer, expectedList) {
  const base64 = imageBuffer.toString("base64");
  const dataUrl = `data:image/jpeg;base64,${base64}`;

  const prompt = `
Lis la photo manuscrite.
Tu dois renvoyer un JSON strict au format :
{ "lines": ["...", "..."] }

Règles :
- Tu choisis UNIQUEMENT parmi les phrases ci-dessous.
- Tu renvoies EXACTEMENT la phrase (mêmes lettres + voyelles) ou "" si absente.
- Tu respectes l'ordre.

Phrases attendues :
${expectedList.map((s, i) => `${i + 1}. ${s}`).join("\n")}
`;

  const response = await openai.responses.create({
    model: "gpt-5.2",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
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
    return expectedList.map(() => "");
  }

  const lines = Array.isArray(parsed.lines) ? parsed.lines : [];
  return expectedList.map((_, i) => (typeof lines[i] === "string" ? lines[i] : ""));
}

// -------- API --------
app.post("/api/correct-handwriting", upload.single("image"), async (req, res) => {
  try {
    const expected = JSON.parse(req.body.expected || "[]");
    if (!req.file || expected.length === 0) {
      return res.status(400).json({ error: "Données manquantes" });
    }

    const gotLines = await readHandwritingArabic(req.file.buffer, expected);

    const items = expected.map((exp, i) => {
      const got = gotLines[i] || "";
      const ok = stripSpaces(exp) === stripSpaces(got);
      return {
        ok,
        expected: exp,
        note: ok ? "" : shortNote(exp, got)
      };
    });

    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// -------- TEST --------
app.get("/", (req, res) => {
  res.send("OK - serveur de correction Talamize actif");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Serveur lancé sur le port", PORT);
});
