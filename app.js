
const express = require("express"); 
const cors = require("cors");
const bodyParser = require("body-parser");
const XLSX = require("xlsx");
const multer = require("multer");
const path = require("path");
const Fuse = require("fuse.js");
const fs = require("fs");
const session = require('express-session');
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const keywordExtractor = require("keyword-extractor");


const app = express();
const PORT = process.env.PORT || 80;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());  // Enables JSON body parsing
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: "secret_key",
  resave: false,
  saveUninitialized: true,
}));

// Ensure 'uploads' directory exists
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const adminUser = { username: "batalks", password: bcrypt.hashSync("happy", 10) }; // ✅ Hash admin password
const usersFile = path.join(__dirname, "client_profiles.json");
const adminFilePath = path.join(__dirname, "admin_profiles.json");
const filePath = path.join(__dirname, "client_profiles.json");


const isAuthenticated = (req, res, next) => {
  if (!req.session.user) {
      return res.redirect("/?unauthorized=true");
  }
  next();
};

// Configure Nodemailer
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
      user: "ashoktirumani9989@gmail.com", // Replace with your email
      pass: "vbxn ntrh tswa oihi",  // Replace with your email password or app password
  },
});

// Load existing tickets or create an empty array
const ticketsFile = "tickets.json";
let tickets = fs.existsSync(ticketsFile) ? JSON.parse(fs.readFileSync(ticketsFile)) : [];

if (fs.existsSync(ticketsFile)) {
    tickets = JSON.parse(fs.readFileSync(ticketsFile));
}


// Helper function to read admin profiles
const readAdmins = () => {
  if (!fs.existsSync(adminFilePath)) return [];
  return JSON.parse(fs.readFileSync(adminFilePath));
};

// Helper function to save admin profiles
const saveAdmins = (admins) => {
  fs.writeFileSync(adminFilePath, JSON.stringify(admins, null, 2));
};

// ✅ Load users from file (if exists)
let users = [];
if (fs.existsSync(usersFile)) {
    users = JSON.parse(fs.readFileSync(usersFile, "utf8"));
}

// Persistent storage for script mappings
const scriptFilePath = "script_mappings.json";
let scriptMappings = fs.existsSync(scriptFilePath) ? JSON.parse(fs.readFileSync(scriptFilePath, "utf-8")) : {};

// In-memory storage for uploaded data
const excelData = {};

// Multer File Upload Setup
const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => cb(null, file.originalname), // Keep original filename
});
const upload = multer({ storage });



let qaData = [];


// Extract keywords from text
function extractKeywords(text) {
  return keywordExtractor.extract(text, {
      language: "english",
      remove_digits: true,
      return_changed_case: true,
      remove_duplicates: true
  });
}

// ✅ Upload and Process Excel Files
app.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const { clientName } = req.body;
  const filePath = req.file.path;
  const originalName = req.file.originalname;
  const scriptId = Date.now().toString(); // Unique script ID

  try {
    // Read Excel file
    const workbook = XLSX.readFile(filePath);
    const sheet = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

    // Save the file mapping
    scriptMappings[originalName] = { scriptId, clientName };
    fs.writeFileSync(scriptFilePath, JSON.stringify(scriptMappings, null, 2));

    // Store data in memory
    excelData[scriptId] = {
      sheet,
      fuse: new Fuse(sheet, { keys: ["Question"], threshold: 0.4 }), // Enable fuzzy search
    };

    // Update script links file
    const scriptLink = `Client: ${clientName}, Script ID: ${scriptId}, File: ${originalName}, URL: /ask/${scriptId}\n`;
    fs.appendFileSync("script_links.txt", scriptLink);

    res.json({ success: true, message: "File uploaded successfully!", scriptId });
  } catch (error) {
    console.error("File processing error:", error);
    res.status(500).json({ error: "Error processing the file" });
  }
});

// Ensure the JSON file exists
if (!fs.existsSync(filePath)) {
  fs.writeFileSync(filePath, JSON.stringify([]));
}

// Function to calculate subscription end date
const calculateEndDate = (startDate, subscriptionType) => {
  let endDate = new Date(startDate);
  if (subscriptionType === "Monthly") endDate.setMonth(endDate.getMonth() + 1);
  else if (subscriptionType === "Quarterly") endDate.setMonth(endDate.getMonth() + 3);
  else if (subscriptionType === "Annually") endDate.setFullYear(endDate.getFullYear() + 1);
  return endDate.toISOString().split("T")[0];
};


// Save New Client Data
app.post("/api/clients", async (req, res) => {
  const clientData = req.body;
  clientData.password = await bcrypt.hash(clientData.password, 10);
  const endDate = calculateEndDate(clientData.subscriptionDate, clientData.subscription);
  
  fs.readFile(filePath, (err, data) => {
      if (err) return res.status(500).json({ error: "Failed to read client data" });
      
      let clients = JSON.parse(data);
      clients.push({ ...clientData, endDate });
      
      fs.writeFile(filePath, JSON.stringify(clients, null, 2), (err) => {
          if (err) return res.status(500).json({ error: "Failed to save client data" });
          res.json({ message: "Client data saved successfully", endDate });
      });
  });
});

// Update Existing Client Data (Admin Only)
app.put("/api/clients/:username", (req, res) => {
  if (!req.session.user || !req.session.user.isAdmin) {
      return res.status(403).json({ error: "Unauthorized" });
  }
  
  const { username } = req.params;
  const updatedData = req.body;
  
  fs.readFile(filePath, async (err, data) => {
      if (err) return res.status(500).json({ error: "Failed to read client data" });
      
      let clients = JSON.parse(data);
      const clientIndex = clients.findIndex(c => c.username === username);
      
      if (clientIndex === -1) return res.status(404).json({ error: "Client not found" });
      
      if (updatedData.password) {
          updatedData.password = await bcrypt.hash(updatedData.password, 10);
      }
      
      clients[clientIndex] = { ...clients[clientIndex], ...updatedData };
      
      fs.writeFile(filePath, JSON.stringify(clients, null, 2), (err) => {
          if (err) return res.status(500).json({ error: "Failed to update client data" });
          res.json({ message: "Client data updated successfully" });
      });
  });
});

// Get All Clients
app.get("/api/clients", (req, res) => {
  fs.readFile(filePath, (err, data) => {
      if (err) return res.status(500).json({ error: "Failed to read client data" });
      res.json(JSON.parse(data));
  });
});

app.get("/api/clients/names", (req, res) => {
  fs.readFile(filePath, (err, data) => {
      if (err) return res.status(500).json({ error: "Failed to read client data" });

      try {
          const clients = JSON.parse(data);
          const clientNames = clients.map(client => client.username); // Assuming 'username' is the client name
          res.json(clientNames);
      } catch (error) {
          res.status(500).json({ error: "Error parsing client data" });
      }
  });
});

app.get("/api/client-profile", (req, res) => {
  if (!req.session.user || req.session.user.isAdmin) {
      return res.status(403).json({ success: false, error: "Unauthorized" });
  }

  fs.readFile(usersFile, (err, data) => {
      if (err) return res.status(500).json({ success: false, error: "Failed to read client data" });

      const clients = JSON.parse(data);
      const client = clients.find(c => c.username === req.session.user.username);

      if (!client) return res.status(404).json({ success: false, error: "Client not found" });

      res.json({
          success: true,
          client: {
              username: client.username,
              email: client.email,
              subscription: client.subscription,
              endDate: client.endDate
          }
      });
  });
});

// API to send mail and save ticket
app.post("/send-mail", async (req, res) => {
  const { ticketNumber, clientName, clientEmail, clientPhone, issue } = req.body;

  if (!clientEmail || !clientPhone || !issue) {
      return res.status(400).json({ message: "All fields are required." });
  }

  const mailOptions = {
      from: "ashoktirumani9989@gmail.com.com",
      to: clientEmail,
      subject: `Ticket Raised - ${ticketNumber}`,
      text: `Dear ${clientName},\n\nYour issue has been registered with Ticket ID: ${ticketNumber}.\nWe will resolve your issue within 7 working days.\n\nThank you.\nSupport Team`,
  };

  try {
      await transporter.sendMail(mailOptions);

      const newTicket = { ticketNumber, clientName, clientEmail, clientPhone, issue, date: new Date().toISOString() };
      tickets.push(newTicket);
      fs.writeFileSync(ticketsFile, JSON.stringify(tickets, null, 2));

      res.json({ success: true, message: `Ticket ${ticketNumber} raised successfully!` });
  } catch (error) {
      console.error("Email Error:", error);
      res.status(500).json({ success: false, message: "Error sending email" });
  }
});

// API to fetch all raised tickets
app.get("/api/tickets-raised", (req, res) => {
  if (fs.existsSync(ticketsFile)) {
    const tickets = JSON.parse(fs.readFileSync(ticketsFile));
    res.json({ success: true, tickets });
  } else {
    res.json({ success: false, message: "No tickets found." });
  }
});

// API to update ticket status and send mail with custom message
app.post("/api/update-ticket", async (req, res) => {
  const { ticketNumber, status, message } = req.body;

  if (!ticketNumber || !status || !message) {
    return res.status(400).json({ message: "Ticket number, status, and message are required." });
  }

  let tickets = fs.existsSync(ticketsFile) ? JSON.parse(fs.readFileSync(ticketsFile)) : [];

  let ticket = tickets.find(t => t.ticketNumber === ticketNumber);
  if (!ticket) {
    return res.status(404).json({ message: "Ticket not found." });
  }

  // Update the ticket status
  ticket.status = status;
  ticket.adminMessage = message;
  fs.writeFileSync(ticketsFile, JSON.stringify(tickets, null, 2));

  // Send email notification
  const mailOptions = {
    from: "ashoktirumani9989@gmail.com",
    to: ticket.clientEmail,
    subject: `Ticket ${status} - ${ticketNumber}: ${message}`,
    text: `Dear ${ticket.clientName},\n\nYour ticket (ID: ${ticketNumber}) has been marked as '${status}'.\n\nMessage from Support: ${message}\n\nThank you,\nSupport Team`,
  };

  try {
    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: `Ticket ${ticketNumber} marked as ${status} and email sent.` });
  } catch (error) {
    console.error("Email Error:", error);
    res.status(500).json({ success: false, message: "Error sending email" });
  }
});

// ✅ Retrieve Script Links
app.get("/script-links", (req, res) => {
  if (!fs.existsSync("script_links.txt")) return res.json({ scripts: [] });
  
  fs.readFile("script_links.txt", "utf-8", (err, data) => {
    if (err) return res.status(500).json({ error: "Error reading script links." });

    const scripts = data.trim().split("\n").map((line) => {
      const parts = line.match(/Client: (.*?), Script ID: (.*?), File: (.*?), URL: (.*)/);
      return parts ? { client: parts[1], scriptId: parts[2], fileName: parts[3], url: parts[4] } : null;
    }).filter(Boolean);

    res.json({ scripts });
  });
});

// ✅ Process Speech Input
app.post("/process-speech/:id", (req, res) => {
  const scriptId = req.params.id;
  const userQuestion = req.body.question?.toLowerCase();

  if (!excelData[scriptId]) return res.status(404).json({ answer: "No data found for this script." });

  const { fuse } = excelData[scriptId];
  const result = fuse.search(userQuestion);
  
  res.json({ answer: result.length ? result[0].item.Answer : "Sorry, please ask related questions." });
});

// ✅ Retrieve Excel Data
app.get("/get-excel/:id", (req, res) => {
  const scriptId = req.params.id;
  const fileEntry = Object.entries(scriptMappings).find(([_, val]) => val.scriptId === scriptId);
  if (!fileEntry) return res.status(404).json({ error: "File not found." });
  
  try {
    const filePath = path.join(__dirname, "uploads", fileEntry[0]);
    const workbook = XLSX.readFile(filePath);
    const sheet = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
    res.json({ sheet });
  } catch (error) {
    res.status(500).json({ error: "Error reading Excel file." });
  }
});

// ✅ Update Excel Data and Reload in Memory
app.put("/update-excel", (req, res) => {
  try {
    const { scriptId, sheet } = req.body;
    if (!scriptId || !Array.isArray(sheet)) return res.status(400).json({ error: "Invalid data format." });

    // Find the file associated with the script ID
    const fileEntry = Object.entries(scriptMappings).find(([_, val]) => val.scriptId === scriptId);
    if (!fileEntry) return res.status(404).json({ error: "File not found." });

    const filePath = path.join(__dirname, "uploads", fileEntry[0]);

    // ✅ Save updated data to the Excel file
    const newWorkbook = XLSX.utils.book_new();
    const newSheet = XLSX.utils.json_to_sheet(sheet);
    XLSX.utils.book_append_sheet(newWorkbook, newSheet, "Sheet1");
    XLSX.writeFile(newWorkbook, filePath);

    // ✅ Reload data in memory
    const updatedWorkbook = XLSX.readFile(filePath);
    const updatedSheet = XLSX.utils.sheet_to_json(updatedWorkbook.Sheets[updatedWorkbook.SheetNames[0]]);

    // ✅ Update in-memory data for voice assistant
    excelData[scriptId] = {
      sheet: updatedSheet,
      fuse: new Fuse(updatedSheet, { keys: ["Question"], threshold: 0.4 }), // Rebuild Fuse.js search
    };

    res.json({ message: "Excel data updated successfully and reloaded for voice assistant!" });
  } catch (error) {
    console.error("Error updating Excel data:", error);
    res.status(500).json({ error: "Server error." });
  }
});


app.delete("/delete/:scriptId", (req, res) => {
  const scriptId = req.params.scriptId;

  // Find the file associated with the script ID
  const fileEntry = Object.entries(scriptMappings).find(([_, val]) => val.scriptId === scriptId);
  if (!fileEntry) return res.status(404).json({ error: "Script not found." });

  const [fileName, scriptData] = fileEntry;
  const filePath = path.join(__dirname, "uploads", fileName);

  try {
    // Delete the Excel file
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    // Remove from scriptMappings
    delete scriptMappings[fileName];
    fs.writeFileSync(scriptFilePath, JSON.stringify(scriptMappings, null, 2));

    // Remove from in-memory storage
    delete excelData[scriptId];

    // Remove the script link from script_links.txt
    let scriptLinks = fs.readFileSync("script_links.txt", "utf-8").split("\n").filter(line => !line.includes(scriptId));
    fs.writeFileSync("script_links.txt", scriptLinks.join("\n"));

    res.json({ message: "Script deleted successfully!" });
  } catch (error) {
    console.error("Error deleting script:", error);
    res.status(500).json({ error: "Server error." });
  }
});

// ✅ Serve the Ask Page
app.get("/ask/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "ask.html"));
});

// Login Route for Admin and Clients
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (username === adminUser.username) {
      // Admin login
      const isAdminValid = await bcrypt.compare(password, adminUser.password);
      if (isAdminValid) {
          req.session.user = { username, isAdmin: true };
          return res.json({ success: true, redirectTo: "/admin" });
      }
  } else {
      // Client login
      fs.readFile(usersFile, async (err, data) => {
          if (err) return res.status(500).json({ error: "Failed to read client data" });

          const clients = JSON.parse(data);
          const client = clients.find(c => c.username === username);

          if (!client) return res.json({ success: false, message: "Invalid username!" });

          const isValidClient = await bcrypt.compare(password, client.password);
          if (isValidClient) {
              req.session.user = { username, isAdmin: false };
              return res.json({ success: true, redirectTo: "/client" });
          }

          return res.json({ success: false, message: "Invalid password!" });
      });
      return;
  }

  res.json({ success: false, message: "Invalid credentials!" });
});

app.get("/main", isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "main.html"));
});

app.get("/admin", isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/client", isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "client.html"));
});


app.get('/profile', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

app.get('/client-details', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client-details.html'));
});

app.get("/script", isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "scripts.html"));
});

app.get("/admin-profile", isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-profile.html"));
});

app.get("/communication", isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "communication.html"));
});

app.get("/client-profile", isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "client-profile.html"));
});

app.get("/send-mail", isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "send-mail.html"));
});

app.get("/tickets-raised", isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "tickets-raised.html"));
});

app.get("/url", isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "url.html"));
});

app.get("/payment-methods",isAuthenticated,(req,res)=>{
  res.sendFile(path.join(__dirname,"public","payment-methods.html"));
});

// API to Get All Tickets
app.get("/tickets", (req, res) => {
  res.json(tickets);
});

// ✅ LOGOUT ROUTE
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
      res.redirect("/");
  });
});

// ✅ Catch-All Route for index.html (Keeps Unauthenticated Users at Login)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start Server
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
