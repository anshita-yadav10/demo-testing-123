const uploadForm = document.getElementById("uploadForm");
const scriptLinkContainer = document.getElementById("scriptLinkContainer");
const askButton = document.getElementById("askButton");

let dynamicScriptId = null;

// ✅ Function to check for duplicate client names
async function isClientNameDuplicate(clientName) {
    try {
        const response = await fetch(" http://localhost:80/script-links");
        if (!response.ok) throw new Error("Failed to fetch script links");

        const data = await response.json();
        return data.scripts.some(script => script.client.toLowerCase() === clientName.toLowerCase());
    } catch (error) {
        console.error("Error checking client name:", error);
        return false;
    }
}

// ✅ Upload Form Submission
uploadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
  
    const clientName = document.getElementById("clientName").value.trim();
    const fileInput = document.getElementById("fileInput").files[0];

    if (!clientName || !fileInput) {
        alert("Please enter a client name and select a file.");
        return;
    }

    // ✅ Check for duplicate client names
    if (await isClientNameDuplicate(clientName)) {
        alert("Client name already exists. Please choose a different name.");
        return;
    }

    const formData = new FormData();
    formData.append("clientName", clientName);
    formData.append("file", fileInput);

    try {
        const response = await fetch(" http://localhost:80/upload", {
            method: "POST",
            body: formData,
        });

        if (!response.ok) throw new Error("Failed to upload file");

        const data = await response.json();
        dynamicScriptId = data.scriptId;

        // ✅ Display script link with details
        scriptLinkContainer.innerHTML = `
            
            <pre>&lt;iframe src=" http://localhost:80/ask/${dynamicScriptId}" allow="microphone" style="border: none;" &gt;&lt;/iframe&gt;</pre>
        `;

        askButton.style.display = "block";
    } catch (error) {
        console.error("File upload error:", error);
        alert("Error uploading file.");
    }
});

// ✅ Ask Me Anything Button
askButton.addEventListener("click", async () => {
    const greeting = new SpeechSynthesisUtterance("How can I help you?");
    window.speechSynthesis.speak(greeting);

    setTimeout(() => {
        const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
        recognition.lang = "en-US";

        recognition.onresult = async (event) => {
            const question = event.results[0][0].transcript;
            try {
                const response = await fetch(` http://localhost:80/process-speech/${dynamicScriptId}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ question }),
                });

                if (!response.ok) throw new Error("Failed to fetch response");

                const data = await response.json();
                const answer = new SpeechSynthesisUtterance(data.answer);
                window.speechSynthesis.speak(answer);
            } catch (error) {
                console.error("Error processing speech:", error);
            }
        };

        recognition.onerror = (err) => {
            console.error("Speech recognition error:", err);
        };

        recognition.start();
    }, 1000);
});
