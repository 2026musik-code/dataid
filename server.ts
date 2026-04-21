import express from "express";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import fs from "fs/promises";
import path from "path";

const app = express();
app.set('trust proxy', true);
app.use(express.json());
const PORT = 3000;

const KEYS_FILE = path.join(process.cwd(), 'server-keys.json');
const ANALYTICS_FILE = path.join(process.cwd(), 'analytics.json');

interface VisitorData {
  ip: string;
  userAgent: string;
  visitCount: number;
  regionsViewed: Record<string, number>;
  lastVisit: string;
}

async function getAnalytics(): Promise<Record<string, VisitorData>> {
  try {
    const data = await fs.readFile(ANALYTICS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return {};
  }
}

async function saveAnalytics(data: Record<string, VisitorData>) {
  await fs.writeFile(ANALYTICS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// Middleware to track analytics
async function trackAnalytics(req: express.Request, regionName?: string) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';
  
  const analytics = await getAnalytics();
  
  if (!analytics[ip]) {
    analytics[ip] = {
      ip,
      userAgent,
      visitCount: 0,
      regionsViewed: {},
      lastVisit: new Date().toISOString()
    };
  }
  
  analytics[ip].visitCount += 1;
  analytics[ip].lastVisit = new Date().toISOString();
  
  if (regionName) {
    analytics[ip].regionsViewed[regionName] = (analytics[ip].regionsViewed[regionName] || 0) + 1;
  }
  
  await saveAnalytics(analytics);
  return analytics[ip];
}

// Check IP limit (e.g. max 50 requests per session/ip roughly)
async function checkIpLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const analytics = await getAnalytics();
  const visitor = analytics[ip];
  
  // Example Limit: 100 requests per IP to avoid spam
  if (visitor && visitor.visitCount > 100) {
     res.status(429).json({ error: "Rate limit exceeded. Coba lagi nanti." });
     return;
  }
  next();
}

async function getApiKeys(): Promise<string[]> {
  try {
    const data = await fs.readFile(KEYS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

async function saveApiKeys(keys: string[]) {
  await fs.writeFile(KEYS_FILE, JSON.stringify(keys), 'utf-8');
}

// API POST /api/save-key (Legacy support)
app.post('/api/save-key', async (req, res) => {
  try {
    const { apiKey } = req.body;
    const keys = await getApiKeys();
    if (!keys.includes(apiKey)) {
       keys.push(apiKey);
       await saveApiKeys(keys);
    }
    res.json({ status: "success" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API Keys Management
app.get('/api/keys', async (req, res) => {
  const keys = await getApiKeys();
  const masked = keys.map(k => ({
    keyId: k.substring(k.length - 8),
    masked: k.substring(0, 4) + '...' + k.substring(k.length - 4),
    full: k 
  }));
  
  let envKeyInfo = null;
  if (process.env.GEMINI_API_KEY) {
     const ek = process.env.GEMINI_API_KEY;
     envKeyInfo = {
         keyId: "ENV_INTERNAL",
         masked: ek.substring(0, 4) + '...' + ek.substring(ek.length - 4)
     };
  }
  
  res.json({ keys: masked, envKey: envKeyInfo });
});

app.delete('/api/keys', async (req, res) => {
   const { keyId } = req.body;
   let keys = await getApiKeys();
   keys = keys.filter(k => k.substring(k.length - 8) !== keyId);
   await saveApiKeys(keys);
   res.json({ status: "success" });
});

app.post('/api/keys', async (req, res) => {
  try {
    const { apiKey } = req.body;
    const keys = await getApiKeys();
    if (!keys.includes(apiKey)) {
       keys.push(apiKey);
       await saveApiKeys(keys);
    }
    res.json({ status: "success" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API POST /api/ping
app.post('/api/ping', async (req, res) => {
  try {
    const { selectedModel, keyId } = req.body;
    const keys = await getApiKeys();
    let activeKey = "";
    
    if (keyId === "env" && process.env.GEMINI_API_KEY) {
       activeKey = process.env.GEMINI_API_KEY;
    } else if (keyId) {
       const found = keys.find((k: string) => k.substring(k.length - 8) === keyId);
       if (found) activeKey = found;
    }
    
    if (!activeKey) activeKey = process.env.GEMINI_API_KEY || keys[0];

    if (!activeKey) {
      res.status(401).json({ error: "API Key not found in configuration." });
      return;
    }
    
    const ai = new GoogleGenAI({ apiKey: activeKey });
    await ai.models.generateContent({
       model: selectedModel || 'gemini-3.1-flash-lite-preview',
       contents: "Test connection ping. Reply simply with 'OK'."
    });
    res.json({ status: "success" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API POST /api/region
app.post('/api/region', checkIpLimit, async (req, res) => {
  try {
    const { provinceName, selectedModel, mapMode = 'SEKOLAH', keyId } = req.body;
    
    // Track visitor
    await trackAnalytics(req, provinceName);
    
    const keys = await getApiKeys();
    let activeKey = "";
    
    if (keyId === "env" && process.env.GEMINI_API_KEY) {
       activeKey = process.env.GEMINI_API_KEY;
    } else if (keyId) {
       const found = keys.find((k: string) => k.substring(k.length - 8) === keyId);
       if (found) activeKey = found;
    }
    
    if (!activeKey) activeKey = process.env.GEMINI_API_KEY || keys[0];
    
    if (!activeKey) {
      res.status(401).json({ error: "API Key not found. Please add an API Key." });
      return;
    }
    
    const ai = new GoogleGenAI({ apiKey: activeKey });
    
    let specificInstruction = "";
    if (mapMode === 'UTAMA') {
      specificInstruction = `Fokus pada statistik umum utama provinsi ini: Total Populasi, Estimasi nilai APBD terbaru, Luas Wilayah, dan persentase Pertumbuhan Ekonomi terbaru. Pada listItems berikan fokus pada ringkasan kebijakan pembangunan utama atau prioritas makro.`;
    } else if (mapMode === 'SEKOLAH') {
      specificInstruction = `Fokus pada statistik jumlah sekolah (SD, SMP, SMA, SMK, dll), kualitas pendidikan, dan distribusi jumlah sekolah di berbagai tingkatan.`;
    } else if (mapMode === 'KOTA') {
      specificInstruction = `Fokus pada jumlah kota administrasi/otonom, nama kota terbesar, tingkat urbanisasi, dan karakteristik khusus perkotaannya.`;
    } else if (mapMode === 'KABUPATEN') {
      specificInstruction = `Fokus pada jumlah kabupaten, luas cakupan kabupaten, distribusi wilayah, dan potensi sumber daya dari berbagai kabupaten.`;
    } else if (mapMode === 'KECAMATAN') {
      specificInstruction = `Fokus pada jumlah total kecamatan, tantangan administratif wilayah, kepadatan kecamatan, atau persebaran pemukiman di kecamatan.`;
    } else if (mapMode === 'KEBIJAKAN ANEH') {
      specificInstruction = `Fokus pada peraturan daerah (Perda), wacana pemerintah lokal, atau kebijakan yang paling unik, aneh, paling kontroversial, atau tak biasa yang pernah atau sedang diterapkan di wilayah ini (seperti larangan tertentu, denda aneh, atau aturan spesifik lokal).`;
    } else {
      specificInstruction = `Fokus pada kondisi SDM, demografi umum, dan kebijakan makro.`;
    }

    const prompt = `Anda adalah Asisten AI Spesialis Data Regional Indonesia.
Tugas Anda adalah menganalisis provinsi: "${provinceName}".

⚠️ PERHATIAN SANGAT PENTING ⚠️
FOKUS ANALISIS SAAT INI ADALAH TENTANG: **${mapMode}**.
${specificInstruction}

JANGAN berikan analisis umum jika fokus yang diminta adalah hal lain. Jika fokusnya adalah SEKOLAH, seluruh data statistik, list, dan summary HARUS murni membahas sekolah, pendidikan, siswa, guru, dll. Demikian pula untuk fokus lainnya.

Kembalikan data HANYA dalam format JSON valid yang berisi persis struktur berikut:
      {
        "title": "${provinceName} - Topik: ${mapMode}",
        "stats": [
          { "label": "Nama Stat 1 (cth: Total Sekolah / Total Kota / dll)", "value": "Angka/Nilai" },
          { "label": "Nama Stat 2", "value": "Angka/Nilai" },
          { "label": "Nama Stat 3", "value": "Angka/Nilai" },
          { "label": "Nama Stat 4", "value": "Angka/Nilai" }
        ],
        "listTitle": "Judul daftar (cth: Kota Terbesar, Prioritas Pendidikan, dll)",
        "listItems": ["Poin 1 detail...", "Poin 2 detail...", "Poin 3 detail..."],
        "summary": "Ringkasan deskriptif terkait fokus analisis di atas (1-2 paragraf pendek)."
      }`;
    
    const result = await ai.models.generateContent({
       model: selectedModel || 'gemini-3.1-flash-lite-preview',
       contents: prompt,
       config: {
         responseMimeType: "application/json",
         responseSchema: {
           type: Type.OBJECT,
           properties: {
             title: { type: Type.STRING },
             stats: { 
               type: Type.ARRAY, 
               items: { 
                 type: Type.OBJECT, 
                 properties: { label: { type: Type.STRING }, value: { type: Type.STRING } },
                 required: ["label", "value"]
               } 
             },
             listTitle: { type: Type.STRING },
             listItems: { type: Type.ARRAY, items: { type: Type.STRING } },
             summary: { type: Type.STRING }
           },
           required: ["title", "stats", "listTitle", "listItems", "summary"]
         }
       }
    });
    const text = result.text || "";
    let cleanJson = text.trim();
    if (cleanJson.startsWith('```json')) {
       cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanJson.startsWith('```')) {
       cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    
    let data;
    try {
      data = JSON.parse(cleanJson);
    } catch (parseError) {
      console.error("JSON parse error on raw output:", cleanJson);
      res.status(500).json({ error: "Format respons AI tidak valid JSON" });
      return;
    }
    
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message, keyContext: "An error occurred with the active key (it might be rate-limited)." });
  }
});

// API POST /api/chat
app.post('/api/chat', checkIpLimit, async (req, res) => {
  try {
    const { userText, selectedRegion, selectedModel } = req.body;
    
    // Track visitor
    await trackAnalytics(req, selectedRegion);
    
    const keys = await getApiKeys();
    const activeKey = process.env.GEMINI_API_KEY || keys[0];

    if (!activeKey) {
       res.status(401).json({ error: "API Key not found in environment or local." });
       return;
    }
    
    const ai = new GoogleGenAI({ apiKey: activeKey });
    const result = await ai.models.generateContent({
       model: selectedModel || 'gemini-3.1-flash-lite-preview',
       contents: `Kamu adalah asisten analisis data wilayah. Fokus pada wilayah: ${selectedRegion || 'Indonesia'}. Pertanyaan user: ${userText}`
    });

    res.json({ text: result.text });
  } catch(e: any) {
    res.status(500).json({ error: e.message });
  }
});

// API GET /api/admin/stats
app.get('/api/admin/stats', async (req, res) => {
  try {
     const analytics = await getAnalytics();
     res.json(analytics);
  } catch (e: any) {
     res.status(500).json({ error: e.message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // for express v4
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
