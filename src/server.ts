// server.ts
import express, { Response, Request } from "express"
import http from "http"
import WebSocket from "ws"

const app = express()
const server = http.createServer(app)
const wss = new WebSocket.Server({ noServer: true })

// Express middleware
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// HTTP Routes
app.get("/", (req, res) => {
  res.send("Server is running")
})

// Function to check if request is from Twilio
function isTwilioRequest(request: http.IncomingMessage): boolean {
  // Check if X-Twilio-Signature header exists
  return !!request.headers["x-twilio-signature"]
}

server.on("upgrade", async (request, socket, head) => {
  try {
    const url = new URL(request.url || "", `http://${request.headers.host}`)
    const pathname = url.pathname

    if (pathname === "/voice-agent-deepgram-demo" && isTwilioRequest(request)) {
      console.log("Handling Twilio voice agent connection")
      wss.handleUpgrade(request, socket, head, (ws) => {
        console.log("Twilio WebSocket connection established")
        // handleVoiceAgent(ws, "en-US")
      })
      return
    }
  } catch (error: any) {
    console.error("Connection error:", error)
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
    socket.destroy()
  }
})

// Error handling middleware
app.use((err: any, req: any, res: any, next: any) => {
  console.error(err.stack)
  res.status(500).send("Something broke!")
})

const PORT = process.env.PORT || 5001

// Start the server
server.listen(PORT, () => {
  console.log(`⚡️ [server]: Server is running on port ${PORT}`)
  console.log(`HTTP: http://localhost:${PORT}`)
  console.log(`WebSocket: ws://localhost:${PORT}`)
})
