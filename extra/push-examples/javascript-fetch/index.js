// Supports: Node.js >= 18, Deno, Bun
const pushURL = "https://example.com/api/push";
const pushToken = "your-token";
const interval = 60;

const push = async () => {
    await fetch(pushURL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Push-Token": pushToken,
        },
        body: JSON.stringify({
            status: "up",
            msg: "OK",
            ping: "",
        }),
    });
    console.log("Pushed!");
};

push();
setInterval(push, interval * 1000);
