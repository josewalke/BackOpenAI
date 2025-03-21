require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { OpenAI } = require("openai");

const app = express();
app.use(express.json());
app.use(cors());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.ASSISTANT_ID;

if (!OPENAI_API_KEY) {
  console.error("❌ ERROR: La API Key de OpenAI no está definida en .env");
  process.exit(1);
}

console.log("✅ OpenAI API Key cargada correctamente");

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;
    console.log("🔵 Recibido mensaje del usuario:", message);

    // Crear thread
    const thread = await openai.beta.threads.create();
    console.log("✅ Thread creado:", thread.id);

    // Enviar mensaje al thread
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: message,
    });
    console.log("✅ Mensaje enviado al hilo");

    // Iniciar ejecución con stream
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: ASSISTANT_ID,
      stream: true,
    });

    console.log("🚀 Asistente ejecutándose...");

    // Configurar headers para SSE (streaming)
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Procesar cada chunk del stream
    for await (const chunk of run) {
      if (chunk.event === "thread.message.delta" && chunk.data?.delta?.content) {
        const parts = chunk.data.delta.content;
    
        for (const part of parts) {
          const text = part?.text?.value || part?.text || "";
          if (text) {
            // ⛔ No hacemos .trim(), ni añadimos nada
            res.write(`data: ${text}\n\n`);
            console.log("📩 Enviando al frontend:", JSON.stringify(text));
          }
        }
      }
    }
    
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    console.error("❌ Error en el backend:", error);
    res.status(500).json({ error: "Error al procesar la solicitud" });
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Backend corriendo en http://localhost:${PORT}`));
