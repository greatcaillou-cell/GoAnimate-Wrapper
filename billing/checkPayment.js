const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// 1. PayPal Credentials (://paypal.com)
const PAYPAL_CLIENT_ID = "YOUR_PAYPAL_CLIENT_ID";
const PAYPAL_SECRET = "YOUR_PAYPAL_SECRET";
const PAYPAL_API = "https://paypal.com"; // Use "https://paypal.com" for live

// 2. Stripe Secret Key (://stripe.com) - Supports Cards, Apple Pay, Google Pay, Cash App Pay
const STRIPE_SECRET_KEY = "YOUR_STRIPE_SECRET_KEY";

// 3. Optional VIP / Manual Access Codes (for Zelle, Crypto, or testers)
const VALID_ACCESS_CODES = ["VIP2026", "CREATOR50"];

const DB_FILE = path.join(__dirname, "paid_users.json");

function getPaidTokens() {
	if (!fs.existsSync(DB_FILE)) return {};
	try {
		return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
	} catch {
		return {};
	}
}

function createSessionToken(method, referenceId) {
	const token = crypto.randomBytes(24).toString("hex");
	const data = getPaidTokens();
	data[token] = { method, referenceId, paidAt: Date.now() };
	fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
	return token;
}

function parseCookies(req) {
	const list = {};
	const rc = req.headers.cookie;
	if (rc) {
		rc.split(";").forEach((cookie) => {
			const parts = cookie.split("=");
			list[parts.shift().trim()] = decodeURI(parts.join("="));
		});
	}
	return list;
}

module.exports = {
	PAYPAL_CLIENT_ID,

	hasValidPaymentMethod: async function (req) {
		const cookies = parseCookies(req);
		const token = cookies.gaw_paid;
		if (!token) return false;
		const paidUsers = getPaidTokens();
		return Boolean(paidUsers[token]);
	},

	// Verify PayPal or Venmo order
	verifyPayPalOrder: async function (orderId) {
		const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString("base64");
		const tokenRes = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
			method: "POST",
			headers: {
				Authorization: `Basic ${auth}`,
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: "grant_type=client_credentials",
		});
		const { access_token } = await tokenRes.json();

		const orderRes = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderId}`, {
			headers: { Authorization: `Bearer ${access_token}` },
		});
		const orderData = await orderRes.json();

		if (orderData.status === "COMPLETED") {
			return createSessionToken("paypal", orderId);
		}
		return null;
	},

	// Create Stripe Checkout Session (Cards, Apple Pay, Google Pay, Cash App Pay)
	createStripeSession: async function (hostUrl) {
		const params = new URLSearchParams({
			mode: "payment",
			success_url: `${hostUrl}/api/verify-stripe?session_id={CHECKOUT_SESSION_ID}`,
			cancel_url: `${hostUrl}/go_full`,
			"line_items[0][price_data][currency]": "usd",
			"line_items[0][price_data][product_data][name]": "GoAnimate Video Maker Access",
			"line_items[0][price_data][unit_amount]": "500", // 500 = $5.00
			"line_items[0][quantity]": "1",
		});

		const res = await fetch("https://stripe.com", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: params.toString(),
		});
		const session = await res.json();
		return session.url;
	},

	// Verify completed Stripe Checkout Session
	verifyStripeSession: async function (sessionId) {
		const res = await fetch(`https://stripe.com/${sessionId}`, {
			headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
		});
		const session = await res.json();

		if (session.payment_status === "paid") {
			return createSessionToken("stripe", sessionId);
		}
		return null;
	},

	// Verify manual access code
	verifyAccessCode: function (code) {
		if (VALID_ACCESS_CODES.includes((code || "").trim())) {
			return createSessionToken("access_code", code);
		}
		return null;
	},
};
