export async function getAvailableTimeSlots({
  startTime,
  endTime,
  duration,
}: {
  startTime: Date
  endTime: Date
  duration: number
}) {
  const res = await fetch("https://api.example.com/available-time-slots", {
    method: "POST",
    body: JSON.stringify({
      startTime,
      endTime,
      duration,
    }),
  })
  return res.json()
}
