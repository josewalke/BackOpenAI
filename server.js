// 📦 Carga variables de entorno desde .env
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { OpenAI } = require("openai");

const app = express();
app.use(express.json()); // 📥 Permite recibir JSON en las peticiones
app.use(cors());         // 🌐 Habilita CORS para permitir llamadas desde el frontend

// 🔐 Carga las claves necesarias desde variables de entorno
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.ASSISTANT_ID;

if (!OPENAI_API_KEY || !ASSISTANT_ID) {
  console.error("❌ Asegúrate de tener OPENAI_API_KEY y ASSISTANT_ID en el .env");
  process.exit(1); // 🚪 Detiene la ejecución si faltan claves
}

console.log("✅ API Key y Assistant ID cargados");

// 🤖 Instancia del cliente de OpenAI
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/**
 * 📩 Ruta principal que recibe mensajes desde el frontend
 */
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;
    console.log("🟦 Mensaje recibido del usuario:", message);

    // 🧵 Crea un nuevo thread de conversación
    const thread = await openai.beta.threads.create();
    console.log("🧵 Thread creado:", thread.id);

    // 💬 Añade el mensaje del usuario al thread
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: message,
    });

    // 🚀 Ejecuta el asistente con transmisión de respuesta activada
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: ASSISTANT_ID,
      stream: true,
    });

    console.log("⚙️ Ejecutando asistente...");

    // 🛠️ Configura respuesta en formato Server-Sent Events (SSE)
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let buffer = ""; // ⏳ Almacena el texto parcial antes de enviarlo al frontend

    // 🔁 Recorre cada fragmento que llega desde OpenAI
    for await (const chunk of run) {
      console.log("📦 Chunk recibido:", JSON.stringify(chunk, null, 2));

      // 🧩 Extrae texto desde el contenido del chunk
      if (chunk.event === "thread.message.delta" && chunk.data?.delta?.content) {
        const parts = chunk.data.delta.content;

        for (const part of parts) {
          const text = part?.text?.value || part?.text || "";
          if (!text) continue;

          console.log("🧩 Fragmento recibido:", JSON.stringify(text));
          buffer += text;

          // 🧠 Divide buffer por espacios, conservando los espacios finales
          const words = buffer.split(/(?<= )/); // regex que conserva los espacios

          // ✉️ Envía al frontend cada palabra (menos la última, que puede ser incompleta)
          while (words.length > 1) {
            const word = words.shift();
            res.write(`data: ${word}\n\n`);
            console.log("📤 Palabra enviada:", JSON.stringify(word));
          }

          // 🧪 Guarda lo que quedó (posible fragmento incompleto)
          buffer = words[0] || "";
        }
      }
    }

    // ✉️ Al finalizar, envía cualquier texto pendiente en el buffer
    if (buffer.trim()) {
      res.write(`data: ${buffer}\n\n`);
      console.log("📤 Última palabra enviada:", JSON.stringify(buffer));
    }

    // ✅ Notifica al frontend que la transmisión ha terminado
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    console.error("❌ Error en /chat:", error);
    res.status(500).json({ error: "Ocurrió un error al procesar el mensaje." });
  }
});

// 🚀 Inicia el servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor backend en http://localhost:${PORT}`);
});
