async function correctHandwritingArabic(imageBuffer, expectedList) {
  const base64 = imageBuffer.toString("base64");
  const dataUrl = `data:image/jpeg;base64,${base64}`;

  const prompt = `
Tu es un correcteur STRICT d'écriture arabe (avec voyelles).

On te donne une photo d'écriture manuscrite + une liste de phrases attendues.
Tu dois répondre avec une correction SIMPLE, phrase par phrase.

RÈGLES STRICTES :
- Tu dois juger à partir de ce que tu VOIS sur la feuille. Ne devine pas.
- Si les lettres (sans voyelles) sont incorrectes => ok:false et note:"Mot incorrect"
- Si les lettres sont correctes MAIS que les voyelles (harakāt/tanwīn/sukūn/ٰ) sont absentes ou incomplètes => ok:false et note:"Voyelles manquantes"
- Si les lettres + voyelles sont présentes mais pas exactement correctes => ok:false et note:"Voyelles à corriger"
- Si tout est correct => ok:true et note:""
- Si la phrase n'apparaît pas sur la photo => ok:false et note:"Manquant"
- Notes doivent être COURTES (pas d'explication longue).

Tu dois sortir un JSON STRICT au format EXACT :
{
  "items": [
    { "ok": true/false, "expected": "PHRASE_ATTENDUE", "note": "" },
    ...
  ]
}

IMPORTANT :
- Tu dois renvoyer exactement les mêmes "expected" dans le même ordre que la liste fournie.
- Ne renvoie rien d'autre que ce JSON.
`;

  const response = await openai.responses.create({
    model: "gpt-5.2",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt + "\n\nListe attendue:\n" + expectedList.map((s, i) => `${i + 1}. ${s}`).join("\n") },
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
    // fallback: tout en "Manquant"
    return expectedList.map(exp => ({ ok: false, expected: exp, note: "Manquant" }));
  }

  const items = Array.isArray(parsed.items) ? parsed.items : [];
  // Normalisation: on garantit expected+ordre
  const mapByExpected = new Map(items.map(it => [it.expected, it]));
  return expectedList.map(exp => {
    const it = mapByExpected.get(exp);
    if (!it) return { ok: false, expected: exp, note: "Manquant" };
    return {
      ok: it.ok === true,
      expected: exp,
      note: typeof it.note === "string" ? it.note : ""
    };
  });
}
