import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, GenerateContentResponse, Chat } from "@google/genai";
import type { DetectionResult, DetectionSource } from './src/types';

dotenv.config();

async function startServer() {
    const app = express();
    const PORT = 3000;

    app.use(express.json({ limit: '10mb' }));

    const API_KEY = process.env.GEMINI_API_KEY;
    if (!API_KEY) {
        console.error("GEMINI_API_KEY environment variable not set");
    }
    const ai = new GoogleGenAI({ apiKey: API_KEY || "" });

    const JSON_PROMPT_INSTRUCTIONS = `
        Your response MUST be a single valid JSON object with ONLY the following keys: "verdict", "confidenceScore", "explanation", "language", and optionally "realNewsSummary".
        - The "verdict" must be one of 'Fake', 'Real', or 'Uncertain'.
        - The "confidenceScore" must be a number between 0 and 100.
        - The "explanation" must be a concise, one-paragraph explanation in English for the verdict.
        - The "language" must be the detected BCP-47 language code of the input text (e.g., "en-US", "hi-IN", "te-IN", "ta-IN").
        - If and ONLY IF the "verdict" is 'Fake', you MUST include the "realNewsSummary" key. This key's value should be a brief, factual summary of the true story, based on your web search. If the verdict is not 'Fake', do not include this key.
        Do not include any text, markdown, or code block formatting outside of the JSON object.
    `;

    // Simple in-memory chat storage for demo purposes
    let activeChat: Chat | null = null;

    app.post("/api/detect", async (req, res) => {
        const { newsText, image } = req.body;
        try {
            let contents: any;
            let prompt: string;

            if (image) {
                prompt = `
                    Extract the text from the following news article image.
                    Then, analyze the extracted text for authenticity. First, detect the primary language of the text.
                    Use Google Search to find verifying sources and cross-reference the information. Your goal is to determine if the news is real or fake and explain why.
                    If you determine the news is fake, you must also provide a summary of what the real news is.
                    ${JSON_PROMPT_INSTRUCTIONS}
                `;
                contents = {
                    parts: [
                        { text: prompt },
                        { inlineData: { mimeType: image.mimeType, data: image.data } }
                    ]
                };
            } else {
                prompt = `
                    Analyze the following news text for authenticity. First, detect the primary language of the text.
                    Use Google Search to find verifying sources and cross-reference the information. Your goal is to determine if the news is real or fake and explain why.
                    If you determine the news is fake, you must also provide a summary of what the real news is.
                    
                    News Text: "${newsText}"

                    ${JSON_PROMPT_INSTRUCTIONS}
                `;
                contents = prompt;
            }

            const response: GenerateContentResponse = await ai.models.generateContent({
                model: "gemini-3-flash-preview",
                contents: contents,
                config: {
                    tools: [{ googleSearch: {} }],
                }
            });

            let jsonText = response.text.trim();
            if (jsonText.startsWith('```json')) {
                jsonText = jsonText.substring(7, jsonText.length - 3).trim();
            } else if (jsonText.startsWith('```')) {
                jsonText = jsonText.substring(3, jsonText.length - 3).trim();
            }

            const partialResult = JSON.parse(jsonText);
            const sources: DetectionSource[] = [];
            const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
            if (groundingChunks) {
                for (const chunk of groundingChunks) {
                    if (chunk.web) {
                        sources.push({ title: chunk.web.title || 'Source', uri: chunk.web.uri });
                    }
                }
            }
            
            res.json({ ...partialResult, sources });
        } catch (error) {
            console.error("Error in /api/detect:", error);
            res.status(500).json({ error: "Analysis failed" });
        }
    });

    app.post("/api/translate", async (req, res) => {
        const { text, targetLanguage } = req.body;
        try {
            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: `Translate the following English text to the language with BCP-47 code '${targetLanguage}'. Only return the translated text, with no extra formatting or explanations.\n\nText: "${text}"`,
            });
            res.json({ translatedText: response.text.trim() });
        } catch (error) {
            console.error("Error in /api/translate:", error);
            res.status(500).json({ error: "Translation failed" });
        }
    });

    app.post("/api/chat/start", (req, res) => {
        const { detectionResult, newsText } = req.body;
        let systemInstruction = `You are an AI assistant helping a user understand a fake news detection result. 
        The initial analysis is provided below. Your role is to answer the user's questions about this analysis clearly and concisely.
        
        Initial News: "${newsText}"
        Verdict: ${detectionResult.verdict}
        Confidence: ${detectionResult.confidenceScore}%
        Explanation: ${detectionResult.explanation}
        Sources: ${detectionResult.sources.map((s: any) => `[${s.title}](${s.uri})`).join(', ')}
        `;
        
        if (detectionResult.realNewsSummary) {
            systemInstruction += `\nThe Real Story: ${detectionResult.realNewsSummary}`;
        }

        activeChat = ai.chats.create({
            model: 'gemini-3-flash-preview',
            config: {
                systemInstruction,
            },
        });
        res.json({ status: "ok" });
    });

    app.post("/api/chat/message", async (req, res) => {
        const { message } = req.body;
        if (!activeChat) {
            return res.status(400).json({ error: "Chat not initialized" });
        }
        try {
            const response: GenerateContentResponse = await activeChat.sendMessage({ message });
            res.json({ response: response.text });
        } catch (error) {
            console.error("Error in /api/chat/message:", error);
            res.status(500).json({ error: "Chat failed" });
        }
    });

    // Vite middleware for development
    if (process.env.NODE_ENV !== "production") {
        const vite = await createViteServer({
            server: { middlewareMode: true },
            appType: "spa",
        });
        app.use(vite.middlewares);
    } else {
        const distPath = path.join(process.cwd(), 'dist');
        app.use(express.static(distPath));
        app.get('*', (req, res) => {
            res.sendFile(path.join(distPath, 'index.html'));
        });
    }

    app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

startServer();
