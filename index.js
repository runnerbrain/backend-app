import 'dotenv/config'
import fs from 'fs'
import jose from 'node-jose'
import { randomUUID } from "crypto"
import axios from 'axios'
import hyperquest from 'hyperquest'
import ndjson from 'ndjson'
import nodemailer from 'nodemailer'
import schedule from 'node-schedule'

// Epic FHIR Configuration
const clientId = "9606bb7a-1e28-4249-bd79-78250232a10b"
const tokenEndpoint = "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token"
const fhirBaseUrl = "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4"
const groupId = "e3iabhmS8rsueyz7vaimuiaSmfGvi.QwjVXJANlPOgR83"



// JWT Authentication
const createJWT = async (payload) => {
  const keys = JSON.parse(fs.readFileSync('keys.json', 'utf8'))
  const key = await jose.JWK.asKey(keys.keys[0], 'json')
  return jose.JWS.createSign({compact: true, fields: {"typ": "jwt", "alg": "RS256"}}, key)
    .update(JSON.stringify(payload))
    .final()
}

const generateExpiry = (minutes) => {
  return Math.round((new Date().getTime() + minutes * 60 * 1000) / 1000)
}

const makeTokenRequest = async () => {
  const jwt = await createJWT({
    "iss": clientId,
    "sub": clientId,
    "aud": tokenEndpoint,
    "jti": randomUUID(),
    "exp": generateExpiry(4),
  })
  
  const formParams = new URLSearchParams()
  formParams.set('grant_type', 'client_credentials')
  formParams.set('client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer')
  formParams.set('client_assertion', jwt)
  
  const tokenResponse = await axios.post(tokenEndpoint, formParams, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    }
  })
  return tokenResponse.data
}

// FHIR Bulk Data Operations
const kickOffBulkDataExport = async (accessToken) => {
  const bulkKickoffResponse = await axios.get(`${fhirBaseUrl}/Group/${groupId}/$export`, {
    params: {
      _type: 'patient,observation',
      _typeFilter: 'Observation?category=laboratory',
    },
    headers: {
      Accept: 'application/fhir+json',
      Authorization: `Bearer ${accessToken}`,
      Prefer: 'respond-async'
    }
  })
  return bulkKickoffResponse.headers.get('Content-Location')
}

const pollAndWaitForExport = async (url, accessToken, secsToWait = 10) => {
  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })
    
    if (response.status === 200) {
      return response.data
    }
  } catch (e) {
    console.log("Error polling bulk export. Retrying...")
  }
  
  console.log(`[${new Date().toISOString()}] Waiting ${secsToWait} seconds before retry...`)
  await new Promise(resolve => setTimeout(resolve, secsToWait * 1000))
  return await pollAndWaitForExport(url, accessToken, secsToWait)
}

const processBulkResponse = async (bundleResponse, accessToken, type, fn) => {
  const filteredOutputs = bundleResponse.output?.filter((output) => output.type === type)
  const promises = filteredOutputs?.map((output) => {
    const url = output.url
    return new Promise((resolve) => {
      const stream = hyperquest(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })
      
      stream.pipe(ndjson.parse()).on('data', fn)
      stream.on('error', resolve)
      stream.on('end', resolve)
    })
  })
  return await Promise.all(promises)
}

// Lab Result Analysis
const checkIfObservationIsNormal = (resource) => {
  const value = resource?.valueQuantity?.value
  if (!resource?.referenceRange) {
    return {isNormal: false, reason: "No reference range found"}
  }
  
  const referenceRangeLow = resource?.referenceRange?.[0]?.low?.value
  const referenceRangeHigh = resource?.referenceRange?.[0]?.high?.value
  
  if (!value || !referenceRangeLow || !referenceRangeHigh) {
    return {isNormal: false, reason: "Incomplete data"}
  }
  
  if (value >= referenceRangeLow && value <= referenceRangeHigh) {
    return {isNormal: true, reason: "Within reference range"}
  } else {
    return {isNormal: false, reason: "Outside reference range"}
  }
}

// Email Service
const sendEmail = async (body) => {
  const transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER || 'your-ethereal-email@ethereal.email',
      pass: process.env.EMAIL_PASS || 'your-ethereal-password'
    }
  })
  return await transporter.sendMail(body)
}

// Main Application Logic
const main = async () => {
  console.log("🚀 Starting Epic FHIR Lab Report Processor...")
  
  try {
    // Step 1: Authenticate with Epic
    console.log("🔐 Authenticating with Epic FHIR...")
    const tokenResponse = await makeTokenRequest()
    const accessToken = tokenResponse.access_token
    console.log("✅ Authentication successful")
    
    // Step 2: Initiate bulk data export
    console.log("📊 Initiating bulk data export...")
    const contentLocation = await kickOffBulkDataExport(accessToken)
    const bulkDataResponse = await pollAndWaitForExport(contentLocation, accessToken, 30)
    console.log("✅ Bulk data export completed")
    
    // Step 3: Process patient data
    console.log("👥 Processing patient data...")
    const patients = {}
    await processBulkResponse(bulkDataResponse, accessToken, 'Patient', (resource) => {
      patients[`Patient/${resource.id}`] = resource
    })
    console.log(`✅ Processed ${Object.keys(patients).length} patients`)
    
    // Step 4: Analyze lab observations
    console.log("🔬 Analyzing lab observations...")
    let abnormalObservations = ``
    let normalObservations = ``
    
    await processBulkResponse(bulkDataResponse, accessToken, 'Observation', (resource) => {
      const {isNormal, reason} = checkIfObservationIsNormal(resource)
      const patient = patients[resource.subject.reference]
      
      if (isNormal) {
        normalObservations += `${resource.code.text}: ${resource?.valueQuantity?.value}. Reason: ${reason}, Patient Name: ${patient?.name?.[0]?.text}, Patient ID: ${patient?.id}\n`
      } else {
        abnormalObservations += `${resource.code.text}. Reason: ${reason}. Patient Name: ${patient?.name?.[0]?.text}, Patient ID: ${patient?.id}\n`
      }
    })
    
    const abnormalCount = abnormalObservations.split('\n').filter(line => line.trim()).length
    const normalCount = normalObservations.split('\n').filter(line => line.trim()).length
    
    console.log(`✅ Found ${abnormalCount} abnormal and ${normalCount} normal observations`)
    
    // Step 5: Generate HTML report
    console.log("📄 Generating HTML report...")
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Epic FHIR Lab Report - ${new Date().toDateString()}</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; background-color: #f8f9fa; }
        .container { max-width: 1000px; margin: 20px auto; background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); overflow: hidden; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
        h1 { margin: 0; font-size: 2.5em; font-weight: 300; }
        .subtitle { margin: 10px 0 0 0; opacity: 0.9; font-weight: 300; }
        .content { padding: 40px; }
        .section { margin: 30px 0; }
        .section h2 { color: #2c3e50; border-bottom: 2px solid #e9ecef; padding-bottom: 10px; margin-bottom: 20px; }
        .observation { margin: 15px 0; padding: 20px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
        .abnormal { background-color: #fff5f5; border-left: 4px solid #e53e3e; }
        .normal { background-color: #f0fff4; border-left: 4px solid #38a169; }
        .patient-info { font-weight: 600; color: #2d3748; font-size: 1.1em; margin-bottom: 8px; }
        .reason { color: #718096; font-style: italic; margin-bottom: 8px; }
        .patient-details { color: #4a5568; font-size: 0.9em; }
        .stats { display: flex; justify-content: space-around; margin: 30px 0; text-align: center; }
        .stat { background: #f7fafc; padding: 20px; border-radius: 8px; flex: 1; margin: 0 10px; }
        .stat-number { font-size: 2em; font-weight: bold; color: #2d3748; }
        .stat-label { color: #718096; margin-top: 5px; }
        .footer { background: #f7fafc; padding: 20px; text-align: center; color: #718096; border-top: 1px solid #e2e8f0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏥 Epic FHIR Lab Report</h1>
            <p class="subtitle">Automated Lab Result Analysis</p>
        </div>
        
        <div class="content">
            <div class="stats">
                <div class="stat">
                    <div class="stat-number">${abnormalCount}</div>
                    <div class="stat-label">Abnormal Results</div>
                </div>
                <div class="stat">
                    <div class="stat-number">${normalCount}</div>
                    <div class="stat-label">Normal Results</div>
                </div>
                <div class="stat">
                    <div class="stat-number">${Object.keys(patients).length}</div>
                    <div class="stat-label">Patients</div>
                </div>
            </div>
            
            <div class="section">
                <h2>🚨 Abnormal Observations</h2>
                ${abnormalObservations.split('\n').filter(line => line.trim()).map(obs => {
                    const match = obs.match(/(.*?)\. Reason: (.*?)\. Patient Name: (.*?), Patient ID: (.*)/);
                    if (match) {
                        const [, test, reason, patientName, patientId] = match;
                        return `<div class="observation abnormal">
                            <div class="patient-info">${test}</div>
                            <div class="reason">Reason: ${reason}</div>
                            <div class="patient-details">Patient: ${patientName} (ID: ${patientId})</div>
                        </div>`;
                    }
                    return `<div class="observation abnormal">${obs}</div>`;
                }).join('')}
            </div>
            
            <div class="section">
                <h2>✅ Normal Observations</h2>
                ${normalObservations.split('\n').filter(line => line.trim()).map(obs => {
                    const match = obs.match(/(.*?): (.*?)\. Reason: (.*?)\. Patient Name: (.*?), Patient ID: (.*)/);
                    if (match) {
                        const [, test, value, reason, patientName, patientId] = match;
                        return `<div class="observation normal">
                            <div class="patient-info">${test}: <span style="color: #38a169; font-weight: 600;">${value}</span></div>
                            <div class="reason">Reason: ${reason}</div>
                            <div class="patient-details">Patient: ${patientName} (ID: ${patientId})</div>
                        </div>`;
                    }
                    return `<div class="observation normal">${obs}</div>`;
                }).join('')}
            </div>
        </div>
        
        <div class="footer">
            <p>Generated on: ${new Date().toLocaleString()}</p>
            <p>Powered by Epic FHIR Integration</p>
        </div>
    </div>
</body>
</html>`

    // Step 6: Save report to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `epic-lab-report-${timestamp}.html`
    fs.writeFileSync(filename, htmlContent, 'utf8')
    console.log(`📄 Report saved to: ${filename}`)
    
    // Step 7: Send email notification
    console.log("📧 Sending email notification...")
    const emailAck = await sendEmail({
      from: '"Epic FHIR Lab Processor" <eliane.gleason4@ethereal.email>',
      to: "eliane.gleason4@ethereal.email",
      subject: `Epic FHIR Lab Report - ${abnormalCount} Abnormal Results - ${new Date().toDateString()}`,
      html: htmlContent,
    })
    console.log("✅ Email sent successfully!")
    
    console.log("🎉 Lab report processing completed successfully!")
    
  } catch (error) {
    console.error("❌ Error in main process:", error.message)
    process.exit(1)
  }
}

// Run the application
if (process.argv.includes('--schedule')) {
  console.log("⏰ Scheduling job to run every 5 minutes...")
  schedule.scheduleJob('*/5 * * * *', main)
} else {
  main()
}