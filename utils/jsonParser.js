/**
 * Robust JSON extraction utility to parse LLM structured outputs
 */

/**
 * Clean and parse JSON from raw text returned by the model.
 * Handles markdown code fences (```json ... ```), surrounding text, and spacing.
 * 
 * @param {string} text - Raw string output from the LLM
 * @returns {Object} Parsed JSON object
 * @throws {Error} If no valid JSON can be extracted or parsed
 */
function parseCleanJson(text) {
    if (!text || typeof text !== "string") {
        throw new Error("Invalid input: text must be a non-empty string");
    }

    let cleaned = text.trim();

    // Remove markdown code fences if they wrap the JSON
    // Matches ```json ... ``` or ``` ... ```
    const codeBlockRegex = /^(?:```json|```)\s*([\s\S]*?)\s*(?:```)$/i;
    const match = cleaned.match(codeBlockRegex);
    if (match) {
        cleaned = match[1].trim();
    }

    try {
        return JSON.parse(cleaned);
    } catch (directError) {
        // If direct parse fails, try to find the outer-most JSON object boundaries
        const firstBrace = cleaned.indexOf("{");
        const lastBrace = cleaned.lastIndexOf("}");

        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            const candidates = cleaned.substring(firstBrace, lastBrace + 1);
            try {
                return JSON.parse(candidates);
            } catch (nestedError) {
                throw new Error(`JSON parsing failed: ${nestedError.message}. Content was: ${candidates}`);
            }
        }

        throw new Error(`Could not find valid JSON boundaries in text: ${directError.message}`);
    }
}

module.exports = {
    parseCleanJson
};
