const express = require("express");
const fs = require("fs");
const app = express();

// Constants (update this in your own app)
const GAME_ADDRESS = "7ESvtfqFrXA2kuzbryDDxVM87Y4bQnAZLR21heza8P8p";
const IVY_URL = "https://ivypowered.com";
const PUBLIC_URL = "https://ldrb.ivypowered.com";
const PORT = 9000;

// Setup
app.set("view engine", "ejs");
app.engine("ejs", require("ejs").__express);
app.use(express.urlencoded({ extended: true }));

// Read leaderboard from the leaderboard file
// { name: string, score: number }[]
function getLeaderboard() {
    try {
        const data = fs.readFileSync("leaderboard.json", "utf8");
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

// Save `leaderboard` to the leaderboard file
function saveLeaderboard(leaderboard) {
    fs.writeFileSync("leaderboard.json", JSON.stringify(leaderboard, null, 4));
}

// Show leaderboard
app.get("/", (req, res) => {
    const leaderboard = getLeaderboard();

    // Render HTML page
    res.render("index", { leaderboard });
});

// Call Ivy API to generate hex ID
async function generateId(amount) {
    const amountRaw = Math.ceil(amount * 1_000_000_000);
    const response = await fetch(`${IVY_URL}/api/id?amountRaw=${amountRaw}`);
    const result = await response.json();
    if (result.status !== "ok") {
        throw new Error(result.msg);
    }
    return result.data;
}

// Read deposits from the deposits file
// id (string) -> deposit ({ amount: string, completed: boolean })
function getDeposits() {
    try {
        const data = fs.readFileSync("deposits.json", "utf8");
        return JSON.parse(data);
    } catch (error) {
        return {};
    }
}

// Save `deposits` to the deposits file
function saveDeposits(deposits) {
    fs.writeFileSync("deposits.json", JSON.stringify(deposits, null, 4));
}

// Begin payment
app.post("/payment-begin", async (req, res) => {
    // Get name + amount
    const { name, amount: amountString } = req.body;
    const amount = parseFloat(amountString);
    if (!name || isNaN(amount) || amount <= 0) {
        return res.status(400).send("Invalid name or amount");
    }

    // Generate ID
    const id = await generateId(amount);

    // Store deposit
    const deposits = getDeposits();
    deposits[id] = {
        name,
        amount,
        completed: false,
    };
    saveDeposits(deposits);

    // Where the user will go after the successful payment
    const redirect = encodeURIComponent(
        `${PUBLIC_URL}/payment-finish?id=${id}`,
    );
    res.redirect(
        `${IVY_URL}/deposit?game=${GAME_ADDRESS}&id=${id}&redirect=${redirect}`,
    );
});

// Call Ivy API to see whether deposit has been completed
async function isDepositComplete(id) {
    const response = await fetch(
        `${IVY_URL}/api/games/${GAME_ADDRESS}/deposits/${id}`,
    );
    const result = await response.json();
    if (result.status !== "ok") {
        throw new Error(result.msg);
    }
    if (!result.data) {
        return false;
    }
    return typeof result.data.signature === "string";
}

// Finish a payment
app.get("/payment-finish", async (req, res) => {
    const { id } = req.query;
    if (!id) {
        res.status(400).send("Invalid ID");
        return;
    }

    const deposits = getDeposits();
    const deposit = deposits[id];
    if (!deposit) {
        res.status(400).send("Deposit not found");
        return;
    }

    const isComplete = await isDepositComplete(id);
    if (isComplete && !deposit.completed) {
        // Retrieve leaderboard
        const leaderboard = getLeaderboard();

        // Insert or increment leaderboard entry for player
        const entry = leaderboard.find((e) => e.name === deposit.name);
        if (entry) {
            entry.score += deposit.amount;
        } else {
            leaderboard.push({
                name: deposit.name,
                score: deposit.amount,
            });
        }

        // Sort leaderboard in descending order
        leaderboard.sort((a, b) => b.score - a.score);

        // Save leaderboard
        saveLeaderboard(leaderboard);

        // Mark deposit as complete
        deposit.completed = true;

        // Save deposits
        saveDeposits(deposits);
    }

    res.render("payment-finish", {
        id,
        name: deposit.name,
        amount: deposit.amount,
        isComplete,
    });
});

app.listen(PORT, () => {
    console.log(`Leaderboard running on port ${PORT}`);
});
