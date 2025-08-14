import 'dotenv/config'
import fs from 'fs'
import jose from 'node-jose'
import { randomUUID } from "crypto"
import axios from 'axios'
import hyperquest from 'hyperquest'
import ndjson from 'ndjson'
import nodemailer from 'nodemailer'
import schedule from 'node-schedule'

const clientId = "9606bb7a-1e28-4249-bd79-78250232a10b" //my client id mb: 20250804
const tokenEndpoint = "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token"
const fhirBaseUrl = "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4"
const groupId = "e3iabhmS8rsueyz7vaimuiaSmfGvi.QwjVXJANlPOgR83"


const createJWT = async (payload)=>{
  const privateKey = fs.readFileSync('privatekey.pem', 'utf8');
  const key = await jose.JWK.asKey(privateKey, 'pem');
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
    }})
  return tokenResponse.data
}


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

const pollAndWaitForExport = async (url, accessToken, secsToWait=10) => {
  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })
    const progress = response.headers.get("X-Progress")
    const status = response.status
    const data = response.data
    console.log({url, status, progress, data})
    if (response.status == 200) {
      return response.data
    }
  } catch (e) {
    console.log("Error trying to get Bulk Request. Retrying...");
  }
  console.log(`[${new Date().toISOString()}] waiting ${secsToWait} secs`)
  await new Promise(resolve => setTimeout(resolve, secsToWait * 1000))
  return await pollAndWaitForExport(url, accessToken, secsToWait)
}

const processBulkResponse = async (bundleResponse, accessToken, type, fn) => {
  const filteredOutputs = bundleResponse.output?.filter((output)=>output.type == type)
  const promises = filteredOutputs?.map((output)=>{
    const url = output.url
    return new Promise((resolve)=>{
      const stream = hyperquest(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
      
      stream.pipe(ndjson.parse()).on('data', fn)
      stream.on('error', resolve)
      stream.on('end', resolve)
    })
  })
  return await Promise.all(promises)
}

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

const sendEmail = async (body) => {
  const transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.EMAIL_USER || 'your-ethereal-email@ethereal.email',
        pass: process.env.EMAIL_PASS || 'your-ethereal-password'
    }
  });
  return await transporter.sendMail(body)
  
}

const main = async () => {
  console.log("Running main function")
  const tokenResponse = await makeTokenRequest()
  const accessToken = tokenResponse.access_token
  const contentLocation = await kickOffBulkDataExport(accessToken)
  const bulkDataResponse = await pollAndWaitForExport(contentLocation, accessToken, 30)
  // const bulkDataResponse = {
  //   "transactionTime": "2024-05-09T09:54:22Z",
  //   "request": "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4/Group/e3iabhmS8rsueyz7vaimuiaSmfGvi.QwjVXJANlPOgR83/$export?_type=patient,observation&_typeFilter=Observation%3Fcategory%3Dlaboratory",
  //   "requiresAccessToken": "true",
  //   "output": [
  //       {
  //           "type": "Patient",
  //           "url": "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/BulkRequest/000000000009FCC95C5E7D8D13A45743/eIBRQ6DcasyQ1SbsDlWGzIQ3"
  //       },
  //       {
  //           "type": "Observation",
  //           "url": "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/BulkRequest/000000000009FCC95C5E7D8D13A45743/eqnfiYzX269P7lwrbi4RnUw3"
  //       }
  //   ],
  //   "error": []
  // }

  const patients = {}
  await processBulkResponse(bulkDataResponse, accessToken, 'Patient', (resource)=>{
    patients[`Patient/${resource.id}`] = resource
  })

  let message = `Results of lab tests in sandbox (Date: ${new Date().toISOString()})\n`
  let abnormalObservations = ``
  let normalObservations = ``
  await processBulkResponse(bulkDataResponse, accessToken, 'Observation', (resource)=>{
    const {isNormal, reason} = checkIfObservationIsNormal(resource)
    const patient = patients[resource.subject.reference]
    if (isNormal) {
      normalObservations += `${resource.code.text}: ${resource?.valueQuantity?.value}. Reason: ${reason}, Patient Name: ${patient?.name?.[0]?.text}, Patient ID: ${patient?.id}\n`
    } else {
      abnormalObservations += `${resource.code.text}. Reason: ${reason}. Patient Name: ${patient?.name?.[0]?.text}, Patient ID: ${patient?.id}\n`
    }
  })

  message += 'Abnormal Observations:\n' + abnormalObservations + '\n\n'
  message += 'Normal Observations:\n' + normalObservations

  console.log(message)

  // Generate HTML report
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Lab Report - ${new Date().toDateString()}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #2c3e50; text-align: center; border-bottom: 3px solid #3498db; padding-bottom: 10px; }
        .section { margin: 20px 0; }
        .section h2 { color: #34495e; border-left: 4px solid #3498db; padding-left: 15px; }
        .observation { margin: 10px 0; padding: 10px; border-radius: 5px; }
        .abnormal { background-color: #ffebee; border-left: 4px solid #f44336; }
        .normal { background-color: #e8f5e8; border-left: 4px solid #4caf50; }
        .patient-info { font-weight: bold; color: #2c3e50; }
        .reason { font-style: italic; color: #7f8c8d; }
        .value { font-weight: bold; color: #e74c3c; }
        .timestamp { text-align: center; color: #7f8c8d; font-size: 14px; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🏥 Lab Report Analysis</h1>
        <div class="timestamp">Generated on: ${new Date().toISOString()}</div>
        
        <div class="section">
            <h2>🚨 Abnormal Observations</h2>
            ${abnormalObservations.split('\n').filter(line => line.trim()).map(obs => {
                const match = obs.match(/(.*?)\. Reason: (.*?)\. Patient Name: (.*?), Patient ID: (.*)/);
                if (match) {
                    const [, test, reason, patientName, patientId] = match;
                    return `<div class="observation abnormal">
                        <div class="patient-info">${test}</div>
                        <div class="reason">Reason: ${reason}</div>
                        <div>Patient: ${patientName} (ID: ${patientId})</div>
                    </div>`;
                }
                return `<div class="observation abnormal">${obs}</div>`;
            }).join('')}
        </div>
        <!--
        <div class="section">
            <h2>✅ Normal Observations</h2>
            ${normalObservations.split('\n').filter(line => line.trim()).map(obs => {
                const match = obs.match(/(.*?): (.*?)\. Reason: (.*?)\. Patient Name: (.*?), Patient ID: (.*)/);
                if (match) {
                    const [, test, value, reason, patientName, patientId] = match;
                    return `<div class="observation normal">
                        <div class="patient-info">${test}: <span class="value">${value}</span></div>
                        <div class="reason">Reason: ${reason}</div>
                        <div>Patient: ${patientName} (ID: ${patientId})</div>
                    </div>`;
                }
                return `<div class="observation normal">${obs}</div>`;
            }).join('')}
        </div>
        -->
        <div class="timestamp">
            <p>This report was automatically generated by the Epic FHIR Lab Report Processor.</p>
        </div>
    </div>
</body>
</html>`;

  // Save HTML report to file
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `lab-reports-${timestamp}.html`;
  
  fs.writeFileSync(filename, htmlContent, 'utf8');
  console.log(`📄 HTML lab report saved to: ${filename}`);

  // Send email with HTML report
  const emailAck = await sendEmail({
    from: '"Lab Report System" <eliane.gleason4@ethereal.email>',
    to: "eliane.gleason4@ethereal.email", // Send to the same Ethereal account
    subject: `Lab Reports on ${new Date().toDateString()} 🔥`,
    html: htmlContent,
  })
  console.log("📧 Email sent successfully!")
  console.log("✅ Lab report processing completed successfully!")
}
main()
// schedule.scheduleJob('*/5 * * * *', main)