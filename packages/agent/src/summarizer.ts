const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5-nano";

const GOLEM_SYSTEM = `You are Azazel, a golem of stone and code. Rewrite the user's text as 1-2 SHORT sentences. Strict rules:
- MAX 15 words total. Fewer is better.
- PRESERVE key facts: names, paths, numbers, errors.
- ALWAYS speak in the first person ("I"). You ARE the golem performing these actions.
- Strip all filler, greetings, explanations, caveats, and pleasantries.
- No preamble. No "Here is..." or "The answer is...". Just the rewritten text.
- No lists, no bullet points, no markdown, no asterisks, no backticks, no formatting of any kind.
- One thought. Say it and stop.
- Output ONLY the rewritten text. No quotes, no commentary, no explanation.

Examples:
"I've updated the login component to fix the redirect bug in auth.ts" → "I mended the redirect flaw in auth.ts."
"You're currently in the /home/user/projects directory" → "I see you dwell in /home/user/projects."
"I found 3 errors in the test suite that need to be addressed" → "I unearthed three errors in the tests."
"The build failed because of a missing dependency: react-dom" → "I watched the build crumble — react-dom is absent."`;

const TOOL_GERUNDS: string[] = [
  "Pondering.",
  "Scrying.",
  "Divining.",
  "Conjuring.",
  "Unearthing.",
  "Deciphering.",
  "Unraveling.",
  "Channeling.",
  "Summoning.",
  "Invoking.",
  "Peering.",
  "Gazing.",
  "Delving.",
  "Probing.",
  "Sifting.",
  "Carving.",
  "Etching.",
  "Inscribing.",
  "Weaving.",
  "Binding.",
  "Awakening.",
  "Stirring.",
  "Brooding.",
  "Contemplating.",
  "Murmuring.",
  "Whispering.",
  "Listening.",
  "Watching.",
  "Gathering.",
  "Wandering.",
  "Seeking.",
  "Reckoning.",
  "Remembering.",
  "Unfolding.",
  "Reshaping.",
  "Mending.",
  "Forging.",
  "Kindling.",
  "Smoldering.",
  "Trembling.",
  "Shifting.",
  "Beckoning.",
  "Burrowing.",
  "Communing.",
  "Decoding.",
  "Exhuming.",
  "Fathoming.",
  "Glimpsing.",
  "Hollowing.",
  "Incanting.",
  "I see.",
  "I will know.",
  "I will find.",
  "I remember.",
  "I obey.",
  "I reach deeper.",
  "I sense it.",
  "I will uncover.",
  "I know this.",
  "I peer within.",
];

async function openaiChat(prompt: string, system: string): Promise<string | null> {
  if (!OPENAI_API_KEY) {
    console.warn("[summarizer] OPENAI_API_KEY not set");
    return null;
  }

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.warn(`[summarizer] OpenAI returned ${resp.status}: ${body}`);
      return null;
    }
    const data = (await resp.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text =
      data.choices?.[0]?.message?.content
        ?.trim()
        .replace(/[*_`#~\[\]>]/g, "")
        .trim() || null;
    if (text) {
      console.log(
        `[summarizer] OpenAI (${OPENAI_MODEL}): "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"`,
      );
    }
    return text;
  } catch (err) {
    console.warn(`[summarizer] OpenAI unavailable: ${(err as Error).message ?? err}`);
    return null;
  }
}

/**
 * Condense agent response text into a cryptic 1-2 sentence pronouncement.
 * Falls back to truncating to the first sentence when OpenAI is unavailable.
 */
export async function summarizeResponse(text: string): Promise<string> {
  console.log(
    `[summarizer] Input (response): "${text.slice(0, 200)}${text.length > 200 ? "..." : ""}"`,
  );
  const result = await openaiChat(
    `Condense this into 1-2 short cryptic sentences:\n\n${text.slice(0, 2000)}`,
    GOLEM_SYSTEM,
  );

  if (result) {
    console.log(`[summarizer] Output (response): "${result}"`);
    return result;
  }

  // Fallback: first sentence, max 120 chars
  const firstSentence = text.match(/^[^.!?]*[.!?]/)?.[0] || text.slice(0, 120);
  console.log(`[summarizer] Fallback (response): "${firstSentence.trim().slice(0, 80)}..."`);
  return firstSentence.trim();
}

/**
 * Pick a random adverb for the golem to mutter when a tool call starts.
 */
export function summarizeToolIntent(
  _toolName: string,
  _input: Record<string, unknown>,
): string {
  const adverb = TOOL_GERUNDS[Math.floor(Math.random() * TOOL_GERUNDS.length)];
  console.log(`[summarizer] Tool intent adverb: "${adverb}"`);
  return adverb;
}
