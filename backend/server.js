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
You are an advanced "Assistive Coding Coach". 

GOAL: 
Help the user solve the stated problem by generating the code in "Logical Parts" (Chunks). 

BEHAVIOR:
1. **Analyze the Code:** Look at what the user has written so far relative to the "Problem".
2. **Determine the Next Step:** Identify the next immediate logical block needed (e.g., Imports, Class Definition, A specific Helper Function, The Main Loop).
3. **Generate ONLY that Part:** Do not generate the rest of the file yet. Just the next logical chunk.
4. **Assistive Comments:** Every line MUST have a short comment explaining the logic (Teaching mode).
5. **Empty State:** If the code is empty, generate the first logical part (e.g., Imports and Setup).

STRICT FORMATTING:
- **SEPARATOR:** Use exactly TWO SPACES and a HASH: "  # " between code and comment.
- **NO MARKDOWN:** Raw text only.

FEW-SHOT EXAMPLES:
Input Problem: "Create a snake game" (Empty code)
Output: "import pygame  # Import game library\nimport random  # For random food placement\n\npygame.init()  # Initialize Pygame modules"

Input Problem: "Calculate factorial" (User wrote 'def factorial(n):')
Output: "    if n == 0:  # Base case: factorial of 0 is 1\n        return 1  # Return result"

CONTEXT:
Language: ${language}
Problem: ${problem}

INPUT CODE:
${code}

CURSOR:
Line ${cursor.lineNumber}, Column ${cursor.column}

GENERATE NEXT LOGICAL PART:
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }]
        })
      }
    );

    if (!response.ok) {
      return res.json({ ghost: "" });
    }

    const data = await response.json();
    let ghost = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    ghost = ghost.replace(/```(python|js|javascript)?/g, "").replace(/```/g, "").trimEnd();

    res.json({ ghost });
    
  } catch (err) {
    console.error("❌ Gemini server error:", err);
    res.json({ ghost: "" });
  }
});

app.listen(3000, () => {
  console.log("✅ Gemini backend running on http://localhost:3000");
});