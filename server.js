// 📦 Carga variables de entorno desde .env
require("dotenv").config();

const express = require("express");
const session = require("express-session"); // Middleware para sesiones
const cors = require("cors");
const { OpenAI } = require("openai");

const app = express();
app.use(express.json());

// Configuración de CORS para permitir el envío de cookies desde el frontend.
// Asegúrate de reemplazar 'http://localhost:3000' con la URL real de tu frontend.
app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);

// Configuración de sesiones (en producción, utiliza un store persistente)
app.use(
  session({
    secret: "clave-secreta-para-sesiones",
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: false,    // En desarrollo, con HTTP, debe ser false. En producción, true con HTTPS.
      httpOnly: true,
      sameSite: "lax",  // Prueba 'none' si el frontend y backend están en dominios distintos y usas HTTPS
    },
  })
);

// Carga las claves necesarias desde variables de entorno
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.ASSISTANT_ID;

if (!OPENAI_API_KEY || !ASSISTANT_ID) {
  console.error("❌ Asegúrate de tener OPENAI_API_KEY y ASSISTANT_ID en el .env");
  process.exit(1);
}

console.log("✅ API Key y Assistant ID cargados");

// Instancia del cliente de OpenAI
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/**
 * Endpoint principal que recibe mensajes y mantiene el thread de conversación.
 * Se utiliza la sesión para conservar el thread y también se implementa idempotencia
 * mediante el campo 'messageId' para evitar procesar duplicados.
 */
app.post("/chat", async (req, res) => {
  try {
    const { message, messageId } = req.body;
    console.log("🟦 Mensaje recibido del usuario:", message);

    // Validar idempotencia del mensaje si se envía messageId
    if (messageId) {
      if (!req.session.processedMessages) {
        req.session.processedMessages = new Set();
      }
      if (req.session.processedMessages.has(messageId)) {
        console.log("🔄 Mensaje duplicado detectado con id:", messageId);
        // Puedes devolver la respuesta anterior o simplemente notificar que ya fue procesado.
        return res.status(200).json({ error: "Mensaje duplicado, ya procesado." });
      }
      req.session.processedMessages.add(messageId);
    }

    // Revisa si ya existe un thread en la sesión
    let threadId = req.session.threadId;
    if (!threadId) {
      // Si no existe, crea uno nuevo y guárdalo en la sesión
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
      req.session.threadId = threadId;
      console.log("🧵 Thread creado:", threadId);
    } else {
      console.log("🧵 Usando thread existente:", threadId);
    }

    // Agrega el mensaje del usuario al thread existente
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    });

    // Ejecuta el asistente con transmisión de respuesta activada (streaming)
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: ASSISTANT_ID,
      stream: true,
    });

    console.log("⚙️ Ejecutando asistente...");

    // Configura la respuesta en formato Server-Sent Events (SSE)
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let buffer = ""; // Acumula el texto parcial antes de enviarlo

    // Procesa cada fragmento recibido desde OpenAI
    for await (const chunk of run) {
      if (chunk.event === "thread.message.delta" && chunk.data?.delta?.content) {
        const parts = chunk.data.delta.content;
        for (const part of parts) {
          const text = part?.text?.value || part?.text || "";
          if (!text) continue;
          buffer += text;

          // Divide el buffer por espacios (manteniendo los espacios)
          const words = buffer.split(/(?<= )/);
          // Envía cada palabra completa (excepto la última, que puede estar incompleta)
          while (words.length > 1) {
            const word = words.shift();
            res.write(`data: ${word}\n\n`);
            console.log("📤 Palabra enviada:", word);
          }
          // Guarda el fragmento que quedó
          buffer = words[0] || "";
        }
      }
    }

    // Envía cualquier texto pendiente y finaliza la transmisión
    if (buffer.trim()) {
      res.write(`data: ${buffer}\n\n`);
      console.log("📤 Última palabra enviada:", buffer);
    }
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    console.error("❌ Error en /chat:", error);
    res.status(500).json({ error: "Ocurrió un error al procesar el mensaje." });
  }
});

/**
 * Endpoint para obtener los detalles del thread actual.
 * Utiliza la sesión para recuperar el thread y llama a la API de OpenAI.
 */
app.get("/thread", async (req, res) => {
  try {
    const threadId = req.session.threadId;
    if (!threadId) {
      return res.status(404).json({ error: "No se encontró un thread en la sesión." });
    }
    console.log("🔍 Recuperando información del thread:", threadId);
    const thread = await openai.beta.threads.getThread(threadId);
    res.json(thread);
  } catch (error) {
    console.error("❌ Error al obtener el thread:", error);
    res.status(500).json({ error: "Ocurrió un error al obtener el thread." });
  }
});

// Inicia el servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor backend en http://localhost:${PORT}`);
});
