require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { OpenAI } = require("openai");

const app = express();
app.use(express.json());
app.use(cors());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.ASSISTANT_ID;

if (!OPENAI_API_KEY || !ASSISTANT_ID) {
  console.error("❌ Asegúrate de tener OPENAI_API_KEY y ASSISTANT_ID en el .env");
  process.exit(1);
}

console.log("✅ API Key y Assistant ID cargados");

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;
    console.log("🟦 Mensaje recibido del usuario:", message);

    // Crear hilo
    const thread = await openai.beta.threads.create();
    console.log("🧵 Thread creado:", thread.id);

    // Agregar mensaje del usuario al thread
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: message,
    });

    // Lanzar run con stream
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: ASSISTANT_ID,
      stream: true,
    });

    console.log("⚙️ Ejecutando asistente...");

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let buffer = ""; // Acumulador de texto

    for await (const chunk of run) {
      console.log("📦 Chunk recibido:", JSON.stringify(chunk, null, 2));

      if (chunk.event === "thread.message.delta" && chunk.data?.delta?.content) {
        const parts = chunk.data.delta.content;

        for (const part of parts) {
          const text = part?.text?.value || part?.text || "";
          if (!text) continue;

          console.log("🧩 Fragmento recibido:", JSON.stringify(text));

          buffer += text;

          // Enviar palabra completa si hay espacio (conserva el espacio)
          const words = buffer.split(/(?<= )/); // divide y mantiene el espacio

          while (words.length > 1) {
            const word = words.shift();
            res.write(`data: ${word}\n\n`);
            console.log("📤 Palabra enviada:", JSON.stringify(word));
          }

          buffer = words[0] || "";
        }
      }
    }

    // Enviar lo que quedó en buffer al final
    if (buffer.trim()) {
      res.write(`data: ${buffer}\n\n`);
      console.log("📤 Última palabra enviada:", JSON.stringify(buffer));
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    console.error("❌ Error en /chat:", error);
    res.status(500).json({ error: "Ocurrió un error al procesar el mensaje." });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor backend en http://localhost:${PORT}`);
});
