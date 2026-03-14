import type { DetectionResult, ChatMessage } from '../types';

export const detectFakeNews = async (newsText: string, image?: { data: string; mimeType: string }): Promise<DetectionResult> => {
    const response = await fetch('/api/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newsText, image })
    });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Analysis failed');
    }
    return response.json();
};

export const translateText = async (text: string, targetLanguage: string): Promise<string> => {
    const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, targetLanguage })
    });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Translation failed');
    }
    const data = await response.json();
    return data.translatedText;
};

export const startChat = async (detectionResult: DetectionResult, newsText: string) => {
    const response = await fetch('/api/chat/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ detectionResult, newsText })
    });
    if (!response.ok) {
        throw new Error('Failed to initialize chat');
    }
};

export const sendMessageToChat = async (message: string): Promise<string> => {
    const response = await fetch('/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
    });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Chat failed');
    }
    const data = await response.json();
    return data.response;
};
