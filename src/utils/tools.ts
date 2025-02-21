import moment from "moment"

export async function getPatientRecord({
  firstName,
  lastName,
  dateOfBirth,
  last4SSN,
}: {
  firstName: string
  lastName: string
  dateOfBirth: Date
  last4SSN?: string
}) {
  try {
    const res = await fetch(
      `https://${process.env.API_BASE_URL}/api/patients/ai/search?patient=${
        firstName + " " + lastName
      }&dob=${dateOfBirth}&last4SSN=${last4SSN}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.AVA_API_KEY}`,
        },
      }
    )
    const data = res.json()
    if (!data) {
      throw new Error("Patient not found")
    }
    return data
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }
}

export async function getAvailableTimeSlots({
  startTime,
  endTime,
  patientId,
}: {
  startTime: Date
  endTime: Date
  patientId: string
}) {
  try {
    const res = await fetch(
      `https://${process.env.API_BASE_URL}/api/appointments/ai?startDate=${startTime}&endDate=${endTime}&patientId=${patientId}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.AVA_API_KEY}`,
        },
      }
    )
    const data = res.json()
    if (!data) {
      throw new Error("No available time slots")
    }
    return data
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }
}

export async function bookTimeSlot({
  patientId,
  date,
  startTime,
  endTime,
  notes,
}: {
  patientId: string
  date: Date
  startTime: Date
  endTime: Date
  notes?: string
}) {
  try {
    const res = await fetch(
      `https://${process.env.API_BASE_URL}/api/appointments/ai/schedule`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.AVA_API_KEY}`,
        },
        body: JSON.stringify({
          patientId,
          date,
          startTime: moment(startTime).utcOffset("America/Chicago"),
          endTime: moment(endTime).utcOffset("America/Chicago"),
          notes,
        }),
      }
    )
    const data = res.json()
    if (!data) {
      throw new Error("Failed to book time slot")
    }
    return data
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }
}

export async function cancelAppointment({
  appointmentId,
  patientId,
  cancellationReason,
}: {
  appointmentId: string
  patientId: string
  cancellationReason?: string
}) {
  try {
    const res = await fetch(
      `https://${process.env.API_BASE_URL}/api/appointments/ai/cancel`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.AVA_API_KEY}`,
        },
        body: JSON.stringify({ appointmentId, patientId, cancellationReason }),
      }
    )
    const data = res.json()
    if (!data) {
      throw new Error("Failed to cancel time slot")
    }
    return data
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }
}
