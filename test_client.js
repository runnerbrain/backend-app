import axios from 'axios'

const clientId = "9606bb7a-1e28-4249-bd79-78250232a10b" // your client id
const fhirBaseUrl = "https://fhir.epic.com"

console.log("Testing Epic client configuration...")
console.log("Client ID:", clientId)
console.log("FHIR Base URL:", fhirBaseUrl)

// Test basic connectivity to Epic
async function testConnection() {
  try {
    console.log("\nTesting basic connectivity...")
    const response = await axios.get(`${fhirBaseUrl}/metadata`)
    console.log("✅ Epic server is reachable")
    console.log("FHIR Version:", response.data.fhirVersion)
    console.log("Server Name:", response.data.software?.name)
  } catch (error) {
    console.log("❌ Cannot reach Epic server")
    console.log("Error:", error.message)
  }
}

// Test client credentials endpoint (without JWT)
async function testClientEndpoint() {
  try {
    console.log("\nTesting client credentials endpoint...")
    const response = await axios.post(`${fhirBaseUrl}/interconnect-fhir-oauth/oauth2/token`, {
      grant_type: 'client_credentials',
      client_id: clientId
    }, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })
    console.log("✅ Client credentials endpoint is working")
  } catch (error) {
    console.log("❌ Client credentials endpoint error:")
    console.log("Status:", error.response?.status)
    console.log("Error:", error.response?.data)
  }
}

testConnection()
testClientEndpoint() 