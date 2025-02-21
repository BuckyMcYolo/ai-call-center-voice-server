// routes/voice-agent/handler.ts
import WebSocket from "ws"
import { createClient, AgentEvents } from "@deepgram/sdk"
import moment from "moment"
import {
  bookTimeSlot,
  cancelAppointment,
  getAvailableTimeSlots,
  getPatientRecord,
} from "../utils/tools"
import dotenv from "dotenv"

dotenv.config()

const deepgram = createClient(process.env.DEEPGRAM_API_KEY)

export function handleVoiceAgent(ws: WebSocket, lang: string) {
  console.log("Setting up Deepgram Voice Agent")
  const connection = deepgram.agent()
  let currentStreamSid: string | null = null

  let hasIssuedWarning = false
  let isWarningInProgress = false
  let silenceWarningTimeout: NodeJS.Timeout | undefined
  let silenceDisconnectTimeout: NodeJS.Timeout | undefined
  let isAgentResponding = false

  function startSilenceDetection() {
    // Clear any existing timeouts
    clearTimers()

    // Don't set timers if the agent is in the middle of responding
    if (isAgentResponding) {
      return
    }

    // Only set warning timer if we haven't warned yet
    if (!hasIssuedWarning) {
      silenceWarningTimeout = setTimeout(() => {
        if (!isAgentResponding) {
          console.log("No interaction detected, sending warning")
          hasIssuedWarning = true
          isWarningInProgress = true // Mark that we're in warning mode
          connection.injectAgentMessage("Are you still there?")

          silenceDisconnectTimeout = setTimeout(() => {
            if (!isAgentResponding) {
              console.log("No response after warning, ending call")
              connection.injectAgentMessage(
                "Since I haven't heard from you, I'll end the call now. Feel free to call back when you're ready. Goodbye!"
              )
              setTimeout(() => {
                ws.close()
              }, 6500)
            }
          }, 7000)
        }
      }, 15000)
    }
  }

  function clearTimers() {
    if (silenceWarningTimeout) clearTimeout(silenceWarningTimeout)
    if (silenceDisconnectTimeout) clearTimeout(silenceDisconnectTimeout)
  }

  // Handle incoming Twilio messages
  function handleTwilioMessage(message: string) {
    try {
      const data = JSON.parse(message)
      //   console.log("Received Twilio event:", data.event)

      switch (data.event) {
        case "start":
          currentStreamSid = data.start.streamSid
          console.log("Call started, StreamSID:", currentStreamSid)

          break

        case "media":
          if (data.media && data.media.payload) {
            // Decode base64 audio from Twilio and send to Deepgram
            const audioData = Buffer.from(data.media.payload, "base64")
            connection.send(audioData)
          }
          break

        case "stop":
          console.log("Call ended")
          currentStreamSid = null
          connection.disconnect()
          connection.removeAllListeners()
          clearTimers()
          ws.close()

          break
      }
    } catch (error) {
      console.error("Error processing Twilio message:", error)
    }
  }

  // Set up Deepgram connection handlers
  connection.on(AgentEvents.Open, async () => {
    console.log("Deepgram connection opened")
    startSilenceDetection()
    connection.configure({
      audio: {
        input: {
          encoding: "mulaw",
          sampleRate: 8000,
        },
        output: {
          encoding: "mulaw",
          sampleRate: 8000,
          container: "none",
        },
      },
      agent: {
        listen: {
          model: "nova-3",
        },
        speak: {
          // @ts-ignore
          provider: "eleven_labs",
          voice_id: process.env.ELEVEN_LABS_VOICE_ID,
        },
        // @ts-ignore (they do support groq but the current SDK doesn't lol)
        think: {
          provider: {
            type: "open_ai",
          },
          model: "gpt-4o-mini",
          instructions: `Your name is Ava. You are a helpful AI Agent that handles appointment scheduling for Axon AI medical clinic. You can schedule, cancel and reschedule patient appointments. You can also provide information about the clinic, such as hours of operation, location, and services. 
          
          ## Instructions
          1. When a patient calls to make changes to an appointment, you should first fetch the patient's record and verify their identity. If one is not found please verify the details with the patient. If the fetch is successful, you'll receive a patient object with the appointments array that contains the patient's appointments and appointment ids.

          2. If the patient wants to cancel an appointment, you should go ahead and cancel the given appointment on the date they are requesting. Then you should prompt them to go ahead and schedule a new appointment. If they are not able to at this time, then just tell them to call back when they are ready.

          3. If the patient wants to schedule or reschedule an appointment, you should first fetch the available appointments, then ask the patient when they are free or looking to reschedule for. Once they have chosen an appointment, you should book the appointment for them.

          ### Additional Details

          When listing times, always say them as 10 o clock AM or 2 o clock PM. For instance, 10:00 AM should be said as 10 o clock AM. 2:00 PM should be said as 2 o clock PM. Dates should be read as for instance April fifth twenty twenty five. You should narrow down what appointment dates the patient wants to a narrow range (2-3 days). Do not list off a long range of times just have a natural dialog with the patient about when they are looking to schedule the appointment and suggest dates if they are unsure.

          HANG UP ONLY WHEN THE USER SAYS GOODBYE OR INDICATES THEY ARE DONE. DO NOT HANG UP IF THE USER IS JUST SAYING THANKS BUT CONTINUING THE CONVERSATION.
            `,
          functions: [
            {
              name: "hang_up",
              description: `End the conversation and close the connection. Call this function when:
        - User says goodbye, thank you, etc.
        - User indicates they're done ("that's all I need", "I'm all set", etc.)
        - User wants to end the conversation
        
        Examples of triggers:
        - "Thank you, bye!"
        - "That's all I needed, thanks"
        - "Have a good day"
        - "Goodbye"
        - "I'm done"
        
        Do not call this function if the user is just saying thanks but continuing the conversation.`,
              parameters: {
                type: "object",
                properties: {
                  shouldHangUp: {
                    type: "boolean", // the type of the input
                    description: "true if the call should be hung up",
                  },
                },
                // @ts-ignore
                required: ["shouldHangUp"],
              },
            },
            {
              name: "get_patient_record",
              description: `Get the patient record (including appointments) from a patient name. date of birth, and last 4 of social security number. If the patient is not found, you should verify the details you received with the patient.
              
              For instance, if the patient's name is "John Doe", you should clarify the spelling by saying "Is the spelling J-O-H-N D-O-E?"
              
              If the patient record is found you should use the returned appoinments array to get the appointment ids for the cancelling function call.
             `,
              parameters: {
                type: "object",
                properties: {
                  firstName: {
                    type: "string",
                    description: "The patient's first name",
                  },
                  lastName: {
                    type: "string",
                    description: "The patient's last name",
                  },
                  dob: {
                    type: "string",
                    description:
                      "The patient's date of birth. Formatted as YYYY-MM-DD",
                  },
                  ssn: {
                    type: "number",
                    description:
                      "The last 4 digits of the patient's social security number (optional)",
                  },
                },
                // @ts-ignore
                required: ["firstName", "lastName", "dob"],
              },
            },
            {
              name: "get_available_time_slots",
              description:
                "Get the available time slots for a given date range. You should call this function first when the caller asks to schedule an appointment. After you get the available time slots, you should present a few options to the caller and ask them to choose one." +
                `the current date is ${moment()
                  .utcOffset("America/Chicago")
                  .format(
                    "YYYY/MM/DD"
                  )} and the current day of the week is  ${moment()
                  .utcOffset("America/Chicago")
                  .format("dddd")}`,
              parameters: {
                type: "object",
                properties: {
                  start: {
                    type: "string",
                    description:
                      "The start date for the time slots to search for. (in ISO 8601 format) CST",
                  },
                  end: {
                    type: "string",
                    description:
                      "The end date for the time slots to search for. (in ISO 8601 format) CST",
                  },
                  patientId: {
                    type: "string",
                    description:
                      "The patient's ID. This is returned from the get_patient_record function",
                  },
                },
                // @ts-ignore
                required: ["start", "end", "patientId"],
              },
            },
            {
              name: "book_time_slot",
              description: `Book a time slot for a patient. You should call this function after the patient has chosen an available time slot and you have presented them to them. If the booking is successful, you should provide a confirmation message to the patient.`,
              parameters: {
                type: "object",
                properties: {
                  patientId: {
                    type: "string",
                    description:
                      "The patient's ID. This is returned from the get_patient_record function",
                  },
                  start: {
                    type: "string",
                    description:
                      "The start date and time for the appointment. (in ISO 8601 format) CST",
                  },
                  end: {
                    type: "string",
                    description:
                      "The end date and time for the appointment. (in ISO 8601 format) CST",
                  },
                  date: {
                    type: "string",
                    description:
                      "The date of the appointment. (in YYYY-MM-DD format)",
                  },
                  notes: {
                    type: "string",
                    description: "Any notes or comments for the appointment",
                  },
                },
                // @ts-ignore
                required: ["patientId", "start", "end", "date"],
              },
            },
            {
              name: "cancel_appointment",
              description: `Book a time slot for a patient. You should call this function after the patient has chosen an available time slot and you have presented them to them. If the booking is successful, you should provide a confirmation message to the patient.`,
              parameters: {
                type: "object",
                properties: {
                  appointmentId: {
                    type: "string",
                    description:
                      "The appointment's ID. This is returned from the get_patient_record function",
                  },
                  patientId: {
                    type: "string",
                    description:
                      "The patient's ID. This is returned from the get_patient_record function",
                  },
                  cancellationReason: {
                    type: "string",
                    description: "The reason for cancelling the appointment",
                  },
                },
                // @ts-ignore
                required: ["appointmentId", "patientId", "cancellationReason"],
              },
            },
          ],
        },
      },
      context: {
        messages: [
          {
            //@ts-ignore
            role: "assistant",
            // type: "assistant",
            content:
              "Hello! Thanks for calling Axon AI medical clinic. I'm Ava, your virtual assistant. How can I help you today?",
          },
        ],
        replay: true,
      },
    })
  })

  // Handle incoming audio from Deepgram
  connection.on(AgentEvents.Audio, (audio) => {
    if (!currentStreamSid) {
      console.log("No StreamSID available, cannot send audio")
      return
    }

    // Send audio to Twilio
    const message = {
      event: "media",
      streamSid: currentStreamSid,
      media: {
        payload: Buffer.from(audio).toString("base64"),
      },
    }
    ws.send(JSON.stringify(message))
  })

  // Handle various Deepgram events
  connection.on(AgentEvents.Error, (error) => {
    console.log("Deepgram error:", error)
  })

  connection.on(AgentEvents.UserStartedSpeaking, (message) => {
    console.log("Deepgram user started speaking:", message)
    hasIssuedWarning = false
    isAgentResponding = false
    isWarningInProgress = false
    clearTimers()
    ws.send(
      JSON.stringify({
        event: "clear",
        streamSid: currentStreamSid,
      })
    )
  })

  connection.on(AgentEvents.AgentAudioDone, (message) => {
    console.log("Deepgram agent audio done:", message)
    if (isWarningInProgress) {
      console.log("Warning in progress; not restarting silence detection.")
      return
    }
    // Add a small delay to ensure all audio is done
    isAgentResponding = false
    setTimeout(() => {
      console.log("Agent response complete, starting silence detection")
      startSilenceDetection()
    }, 3000)
  })

  connection.on(AgentEvents.AgentStartedSpeaking, (message) => {
    console.log("Deepgram agent started speaking:", message)
    if (isWarningInProgress) {
      console.log("Detected warning message; ignoring as user response.")
      // Reset the flag after a short delay (if necessary)
      // setTimeout(() => {
      //   isWarningMessage = false
      // }, 500)
      setTimeout(() => {
        isWarningInProgress = false
      }, 500)
      return
    }
    isAgentResponding = true
    clearTimers()
  })

  connection.on(AgentEvents.AgentThinking, (message) => {
    console.log("Deepgram agent thinking:", message)
  })

  // Log agent messages for debugging
  connection.on(AgentEvents.ConversationText, (message) => {
    console.log("User message:", message)
    if (message.role === "assistant") {
      console.log("Agent starting new response")
      if (isWarningInProgress) {
        console.log("Detected warning message; ignoring as user response.")
        return
      }
      isAgentResponding = true
      clearTimers()
    }
  })

  connection.on(AgentEvents.FunctionCallRequest, (message) => {
    console.log("Function Call Request:", message)
    console.log("Calling function:", message.function_name)
    if (message.function_name === "hang_up") {
      connection.injectAgentMessage(
        "If you have any further questions, please don't hesitate to call us back. Goodbye!"
      )
      setTimeout(() => {
        ws.close()
      }, 5500)
    }

    if (message.function_name === "get_patient_record") {
      console.log("Getting patient record")
      isAgentResponding = true
      clearTimers()
      getPatientRecord({
        firstName: message.input.firstName,
        lastName: message.input.lastName,
        dateOfBirth: message.input.dob,
        last4SSN: message.input.ssn,
      })
        .then((data) => {
          console.log("Patient record:", data)
          connection.functionCallResponse({
            function_call_id: message.function_call_id,
            output: JSON.stringify(data),
          })
        })
        .catch((error) => {
          console.error("Error getting patient record:", error)
          isAgentResponding = false
          connection.injectAgentMessage(
            `I'm sorry, I'm having trouble finding the patient record right now.`
          )
          connection.functionCallResponse({
            function_call_id: message.function_call_id,
            output: JSON.stringify({ error: error.message }),
          })
        })
    }

    if (message.function_name === "get_available_time_slots") {
      console.log("Getting available time slots")
      isAgentResponding = true
      clearTimers()
      connection.injectAgentMessage(
        `I can help you with that. Let me check the available time slots for you.`
      )
      getAvailableTimeSlots({
        startTime: message.input.start,
        endTime: message.input.end,
        patientId: message.input.patientId,
      })
        .then((data) => {
          console.log("Available time slots:", data)
          connection.functionCallResponse({
            function_call_id: message.function_call_id,
            output: JSON.stringify(data),
          })
        })
        .catch((error) => {
          console.error("Error getting available time slots:", error)
          isAgentResponding = false
          connection.injectAgentMessage(
            `I'm sorry, I'm having trouble finding available time slots right now.`
          )
          connection.functionCallResponse({
            function_call_id: message.function_call_id,
            output: JSON.stringify({ error: error.message }),
          })
        })
    }
    if (message.function_name === "book_time_slot") {
      console.log("Booking time slot")
      isAgentResponding = true
      clearTimers()
      bookTimeSlot({
        patientId: message.input.patientId,
        startTime: message.input.start,
        endTime: message.input.end,
        date: message.input.date,
        notes: message.input.notes,
      })
        .then((data) => {
          console.log("Booking successful:", data)
          connection.functionCallResponse({
            function_call_id: message.function_call_id,
            output: JSON.stringify(data),
          })
        })
        .catch((error) => {
          console.error("Error booking time slot:", error)
          isAgentResponding = false
          connection.injectAgentMessage(
            `I'm sorry, I'm having trouble booking the time slot right now.`
          )
        })
    }
    if (message.function_name === "cancel_appointment") {
      console.log("Cancelling appointment")
      isAgentResponding = true
      clearTimers()
      connection.injectAgentMessage(`Let me cancel the appointment for you.`)
      cancelAppointment({
        appointmentId: message.input.appointmentId,
        patientId: message.input.patientId,
        cancellationReason: message.input.cancellationReason,
      })
        .then((data) => {
          console.log("Appointment cancelled:", data)
          connection.functionCallResponse({
            function_call_id: message.function_call_id,
            output: JSON.stringify({ message: "Appointment cancelled" }),
          })
        })
        .catch((error) => {
          console.error("Error cancelling appointment:", error)
          isAgentResponding = false
          connection.injectAgentMessage(
            `I'm sorry, I'm having trouble cancelling the appointment right now.`
          )
        })
    }
  })

  connection.on(AgentEvents.FunctionCalling, (message) => {
    console.log("Function Calling:", message)
  })

  connection.on(AgentEvents.SettingsApplied, (message) => {
    console.log("Settings applied:", message)
  })

  connection.on(AgentEvents.Close, () => {
    console.log("Deepgram connection closed")
    connection.removeAllListeners()
    currentStreamSid = null
    ws.close()
    clearTimers()
  })

  // Handle WebSocket events
  ws.on("message", (message: WebSocket.Data) => {
    handleTwilioMessage(message.toString())
  })

  ws.on("close", () => {
    console.log("Twilio connection closed")
    connection.removeAllListeners()
    connection.disconnect()
    currentStreamSid = null
    clearTimers()
  })
  ws.on("error", (error) => {
    console.error("WebSocket error:", error)
    connection.removeAllListeners()
    connection.disconnect()
    currentStreamSid = null
    clearTimers()
  })
}
