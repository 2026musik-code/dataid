import { GoogleGenAI, Type } from "@google/genai";

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  GEMINI_API_KEY: string;
  VPSAI_BUCKET: R2Bucket;
}

interface VisitorData {
  ip: string;
  userAgent: string;
  visitCount: number;
  regionsViewed: Record<string, number>;
  lastVisit: string;
}

// Utility to get all keys
async function getApiKeys(env: Env): Promise<string[]> {
  try {
    const obj = await env.VPSAI_BUCKET.get('gemini_api_keys_list');
    if (obj) {
      return JSON.parse(await obj.text());
    }
    // Fallback to old single key
    const oldObj = await env.VPSAI_BUCKET.get('gemini_api_key');
    if (oldObj) {
      const oldKey = await oldObj.text();
      // migrate quietly
      await env.VPSAI_BUCKET.put('gemini_api_keys_list', JSON.stringify([oldKey]));
      return [oldKey];
    }
  } catch (e) {
    console.error(e);
  }
  return [];
}

async function saveApiKeys(env: Env, keys: string[]) {
  await env.VPSAI_BUCKET.put('gemini_api_keys_list', JSON.stringify(keys));
}

// Analytics Utils
async function getAnalytics(env: Env): Promise<Record<string, VisitorData>> {
  try {
    const obj = await env.VPSAI_BUCKET.get('analytics_data');
    if (obj) {
      return JSON.parse(await obj.text());
    }
  } catch (e) {
    console.error(e);
  }
  return {};
}

async function saveAnalytics(env: Env, data: Record<string, VisitorData>) {
  await env.VPSAI_BUCKET.put('analytics_data', JSON.stringify(data));
}

async function trackAnalytics(req: Request, env: Env, regionName?: string) {
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const userAgent = req.headers.get('User-Agent') || 'unknown';
  
  const analytics = await getAnalytics(env);
  
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
  
  if (regionName && regionName.trim() !== '') {
    analytics[ip].regionsViewed[regionName] = (analytics[ip].regionsViewed[regionName] || 0) + 1;
  }
  
  await saveAnalytics(env, analytics);
  return analytics[ip];
}

async function checkIpLimit(req: Request, env: Env): Promise<boolean> {
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const analytics = await getAnalytics(env);
  const visitor = analytics[ip];
  
  if (visitor && visitor.visitCount > 100) {
     return true; // limit exceeded
  }
  return false;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // API GET /api/admin/stats
    if (request.method === 'GET' && url.pathname === '/api/admin/stats') {
       try {
         const analytics = await getAnalytics(env);
         return new Response(JSON.stringify(analytics), { headers: { 'Content-Type': 'application/json' }});
       } catch (err: any) {
         return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' }});
       }
    }

    // AI POST /api/save-key (Legacy support, redirects to array logic)
    if (request.method === 'POST' && url.pathname === '/api/save-key') {
      try {
        const { apiKey } = await request.json() as { apiKey: string };
        const keys = await getApiKeys(env);
        if (!keys.includes(apiKey)) {
           keys.push(apiKey);
           await saveApiKeys(env, keys);
        }
        return new Response(JSON.stringify({ status: "success" }), { headers: { 'Content-Type': 'application/json' }});
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' }});
      }
    }

    // API Keys Management
    if (url.pathname === '/api/keys') {
      if (request.method === 'GET') {
        const keys = await getApiKeys(env);
        const masked = keys.map(k => ({
          keyId: k.substring(k.length - 8),
          masked: k.substring(0, 4) + '...' + k.substring(k.length - 4),
          full: k // WARNING: sent to admin client to identify exact key if needed, or we just leave it out. Wait, better left out for safety, but the client needs to use it? Neither frontend nor worker calls APIs without worker. Worker holds keys. So just sending ID is safe.
        }));
        
        let envKeyInfo = null;
        if (env.GEMINI_API_KEY) {
           envKeyInfo = {
               keyId: "ENV_INTERNAL",
               masked: env.GEMINI_API_KEY.substring(0, 4) + '...' + env.GEMINI_API_KEY.substring(env.GEMINI_API_KEY.length - 4)
           };
        }
        
        return new Response(JSON.stringify({ keys: masked, envKey: envKeyInfo }), { headers: { 'Content-Type': 'application/json' }});
      }
      if (request.method === 'DELETE') {
         const { keyId } = await request.json() as { keyId: string };
         let keys = await getApiKeys(env);
         keys = keys.filter(k => k.substring(k.length - 8) !== keyId);
         await saveApiKeys(env, keys);
         return new Response(JSON.stringify({ status: "success" }), { headers: { 'Content-Type': 'application/json' }});
      }
      return new Response("Not found", {status: 404});
    }

    // AI POST /api/ping
    if (request.method === 'POST' && url.pathname === '/api/ping') {
      try {
        const body = await request.json() as { selectedModel?: string, keyId?: string };
        const { selectedModel, keyId } = body;
        
        const keys = await getApiKeys(env);
        let activeKey = "";
        
        if (keyId === "env" && env.GEMINI_API_KEY) {
           activeKey = env.GEMINI_API_KEY;
        } else if (keyId) {
           const found = keys.find((k: string) => k.substring(k.length - 8) === keyId);
           if (found) activeKey = found;
        }
        
        if (!activeKey) {
           activeKey = env.GEMINI_API_KEY || keys[0];
        }

        if (!activeKey) {
          return new Response(JSON.stringify({ error: "API Key not found in R2." }), { status: 401, headers: { 'Content-Type': 'application/json' }});
        }
        
        const ai = new GoogleGenAI({ apiKey: activeKey });
        await ai.models.generateContent({
           model: selectedModel || 'gemini-3.1-flash-lite-preview',
           contents: "Test connection ping. Reply simply with 'OK'."
        });
        return new Response(JSON.stringify({ status: "success" }), { headers: { 'Content-Type': 'application/json' }});
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' }});
      }
    }

    // AI POST /api/region
    if (request.method === 'POST' && url.pathname === '/api/region') {
      try {
        if (await checkIpLimit(request, env)) {
           return new Response(JSON.stringify({ error: "Rate limit exceeded. Coba lagi nanti." }), { status: 429, headers: { 'Content-Type': 'application/json' }});
        }
        
        const body = await request.json() as { provinceName: string, selectedModel: string, mapMode?: string, keyId?: string };
        const { provinceName, selectedModel, mapMode = 'SEKOLAH', keyId } = body;
        
        await trackAnalytics(request, env, provinceName);
        
        const keys = await getApiKeys(env);
        let activeKey = "";
        
        if (keyId === "env" && env.GEMINI_API_KEY) {
           activeKey = env.GEMINI_API_KEY;
        } else if (keyId) {
           const found = keys.find((k: string) => k.substring(k.length - 8) === keyId);
           if (found) activeKey = found;
        }
        
        // Fallback checks
        if (!activeKey) {
           activeKey = env.GEMINI_API_KEY || keys[0];
        }
        
        if (!activeKey) {
          return new Response(JSON.stringify({ error: "API Key not found. Please add an API Key in Settings." }), { status: 401, headers: { 'Content-Type': 'application/json' }});
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
          return new Response(JSON.stringify({ error: "Format respons AI tidak valid JSON" }), { status: 500, headers: { 'Content-Type': 'application/json' }});
        }
        
        return new Response(JSON.stringify(data), {
           headers: { 'Content-Type': 'application/json' }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message, keyContext: "An error occurred with the active key (it might be rate-limited)." }), { status: 500, headers: { 'Content-Type': 'application/json' }});
      }
    }

    // AI POST /api/chat
    if (request.method === 'POST' && url.pathname === '/api/chat') {
      try {
        if (await checkIpLimit(request, env)) {
           return new Response(JSON.stringify({ error: "Rate limit exceeded. Coba lagi nanti." }), { status: 429, headers: { 'Content-Type': 'application/json' }});
        }
        
        const body = await request.json() as { userText: string, selectedRegion: string, selectedModel: string };
        const { userText, selectedRegion, selectedModel } = body;
        
        await trackAnalytics(request, env, selectedRegion);
        
        const keys = await getApiKeys(env);
        const activeKey = env.GEMINI_API_KEY || keys[0];

        if (!activeKey) {
           return new Response(JSON.stringify({ error: "API Key not found in environment or R2." }), { status: 401, headers: { 'Content-Type': 'application/json' }});
        }
        
        const ai = new GoogleGenAI({ apiKey: activeKey });
        const result = await ai.models.generateContent({
           model: selectedModel || 'gemini-3.1-flash-lite-preview',
           contents: `Kamu adalah asisten analisis data wilayah. Fokus pada wilayah: ${selectedRegion || 'Indonesia'}. Pertanyaan user: ${userText}`
        });

        return new Response(JSON.stringify({ text: result.text }), { headers: { 'Content-Type': 'application/json' }});
      } catch(e: any) {
         return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' }});
      }
    }

    // For any other route, pass to SPA Fallback
    try {
      if (request.method === 'GET' && !url.pathname.startsWith('/api/') && !url.pathname.includes('.')) {
        // SPA Fallback: Serve index.html
        if (env.ASSETS) {
           return await env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
        } else {
           // If somehow ASSETS is not bound correctly
           return new Response("Index.html not found, ASSETS binding is missing.", {status: 404});
        }
      }
      return env.ASSETS ? await env.ASSETS.fetch(request) : new Response("Not found", {status: 404});
    } catch (e: any) {
      return new Response(JSON.stringify({ error: "Worker crash on ASSETS: " + e.message, stack: e.stack }), { status: 500 });
    }
  }
}
