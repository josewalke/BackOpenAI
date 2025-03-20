require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { OpenAI } = require("openai");

const app = express();
app.use(express.json());
app.use(cors());

// 🔑 Cargar API Key desde .env
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.ASSISTANT_ID; // ID del asistente

// 🛠️ Verificar que la API Key se cargó correctamente
if (!OPENAI_API_KEY) {
  console.error("❌ ERROR: La API Key de OpenAI no está definida en .env");
  process.exit(1); // Detiene la ejecución si falta la API Key
}

console.log("✅ OpenAI API Key cargada correctamente");

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;
    console.log("🔵 Recibido mensaje del usuario:", message);

    // 1️⃣ Crear un thread (hilo) para la conversación
    const thread = await openai.beta.threads.create();
    console.log("✅ Thread creado:", thread.id);

    // 2️⃣ Enviar el mensaje del usuario al hilo
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: message,
    });
    console.log("✅ Mensaje enviado al hilo");

    // 3️⃣ Ejecutar el asistente en el hilo
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: ASSISTANT_ID,
    });
    console.log("🚀 Asistente ejecutándose en el hilo...");

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // 4️⃣ Polling: Revisar el estado del asistente hasta que haya respuesta
    while (true) {
      const runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      console.log("⏳ Estado actual del asistente:", runStatus.status);

      if (runStatus.status === "failed") {
        console.error("❌ Error en la ejecución:", runStatus.last_error);
        res.write("❌ Error en el asistente: " + JSON.stringify(runStatus.last_error));
        break;
      }

      if (runStatus.status === "completed") {
        console.log("✅ Respuesta completada. Enviando al frontend...");

        // 5️⃣ Obtener la respuesta del asistente
        const messages = await openai.beta.threads.messages.list(thread.id);
        const responseText = messages.data
          .filter((msg) => msg.role === "assistant")
          .map((msg) => msg.content[0].text.value)
          .join("\n");

        console.log("📩 Respuesta del asistente:", responseText);

        res.write(responseText);
        break;
      }

      // Esperar antes de volver a revisar (1 seg)
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    res.end();
  } catch (error) {
    console.error("❌ Error en el backend:", error);

    if (error.response) {
      console.error("🔴 Respuesta del servidor OpenAI:", error.response.data);
    }

    res.status(500).json({ error: "Error al procesar la solicitud" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Backend corriendo en http://localhost:${PORT}`));
