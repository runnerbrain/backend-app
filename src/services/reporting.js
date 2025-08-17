import fs from 'fs'
import nodemailer from 'nodemailer'

export class ReportingService {
  static generateHTMLReport(analysis, patients) {
    const { abnormalObservations, normalObservations, abnormalCount, normalCount } = analysis
    
    return `
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
                ${this.formatObservations(abnormalObservations, 'abnormal')}
            </div>
            
            <div class="section">
                <h2>✅ Normal Observations</h2>
                ${this.formatObservations(normalObservations, 'normal')}
            </div>
        </div>
        
        <div class="footer">
            <p>Generated on: ${new Date().toLocaleString()}</p>
            <p>Powered by Epic FHIR Integration</p>
        </div>
    </div>
</body>
</html>`
  }

  static formatObservations(observations, type) {
    return observations.split('\n').filter(line => line.trim()).map(obs => {
      if (type === 'abnormal') {
        const match = obs.match(/(.*?)\. Reason: (.*?)\. Patient Name: (.*?), Patient ID: (.*)/)
        if (match) {
          const [, test, reason, patientName, patientId] = match
          return `<div class="observation abnormal">
              <div class="patient-info">${test}</div>
              <div class="reason">Reason: ${reason}</div>
              <div class="patient-details">Patient: ${patientName} (ID: ${patientId})</div>
          </div>`
        }
      } else {
        const match = obs.match(/(.*?): (.*?)\. Reason: (.*?)\. Patient Name: (.*?), Patient ID: (.*)/)
        if (match) {
          const [, test, value, reason, patientName, patientId] = match
          return `<div class="observation normal">
              <div class="patient-info">${test}: <span style="color: #38a169; font-weight: 600;">${value}</span></div>
              <div class="reason">Reason: ${reason}</div>
              <div class="patient-details">Patient: ${patientName} (ID: ${patientId})</div>
          </div>`
        }
      }
      return `<div class="observation ${type}">${obs}</div>`
    }).join('')
  }

  static saveReport(htmlContent) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `epic-lab-report-${timestamp}.html`
    fs.writeFileSync(filename, htmlContent, 'utf8')
    return filename
  }

  static async sendEmail(htmlContent, analysis) {
    const transporter = nodemailer.createTransporter({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER || 'your-ethereal-email@ethereal.email',
        pass: process.env.EMAIL_PASS || 'your-ethereal-password'
      }
    })

    const { abnormalCount } = analysis
    
    return await transporter.sendMail({
      from: '"Epic FHIR Lab Processor" <eliane.gleason4@ethereal.email>',
      to: "eliane.gleason4@ethereal.email",
      subject: `Epic FHIR Lab Report - ${abnormalCount} Abnormal Results - ${new Date().toDateString()}`,
      html: htmlContent,
    })
  }
}

