import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY missing in .env");
  process.exit(1);
}

app.post("/suggest", async (req, res) => {
  try {
    const { problem, code, cursor, language } = req.body;

    const prompt = `
You are a coding coach providing inline ghost text.

ABSOLUTE RULES:
- Output ONLY code
- NO explanations
- NO markdown
- NO commentary
- Do NOT repeat unchanged lines
- Do NOT rewrite large sections
- MAXIMUM 3 lines

CRITICAL BEHAVIOR RULES:
- You MAY complete the current line at the cursor
- You MAY finish a block the user has clearly started
- EVEN IF the suggestion completes the solution, you MUST return it
- Prefer the SMALLEST possible continuation
- If no reasonable continuation exists, return NOTHING

Problem:
${problem}

Language:
${language}

Code so far:
${code || "(empty)"}

Cursor:
line ${cursor?.line ?? "?"}, column ${cursor?.column ?? "?"}

Ghost code:
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }]
            }
          ]
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("❌ Gemini HTTP error:", errText);
      return res.json({ ghost: "" });
    }

    const data = await response.json();

    const ghost =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

    res.json({ ghost });
  } catch (err) {
    console.error("❌ Gemini server error:", err);
    res.json({ ghost: "" });
  }
});

app.listen(3000, () => {
  console.log("✅ Gemini backend running on http://localhost:3000");
});
