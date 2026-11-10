const env = Object.assign(process.env, require("./env"), require("./config"));

const http = require("http");
const chr = require("./character/redirect");
const pmc = require("./character/premade");
const chl = require("./character/load");
const chs = require("./character/save");
const cht = require("./character/thmb");
const mwu = require("./movie/upload");
const asu = require("./asset/upload");
const stl = require("./static/load");
const stp = require("./static/page");
const asl = require("./asset/load");
const asL = require("./asset/list");
const ast = require("./asset/thmb");
const mvl = require("./movie/load");
const mvL = require("./movie/list");
const mvm = require("./movie/meta");
const mvs = require("./movie/save");
const mvt = require("./movie/thmb");
const thL = require("./theme/list");
const thl = require("./theme/load");
const tsv = require("./tts/voices");
const tsl = require("./tts/load");
const url = require("url");
const {
	hasValidPaymentMethod,
	verifyPayPalOrder,
	createStripeSession,
	verifyStripeSession,
	verifyAccessCode,
	PAYPAL_CLIENT_ID,
} = require("./billing/checkPayment");

const functions = [mvL, pmc, asl, chl, thl, thL, chs, cht, asL, tsl, chr, ast, mvm, mvl, mvs, mvt, tsv, asu, mwu, stp, stl];

function setCookieAndRedirect(res, token, redirectUrl) {
	res.writeHead(302, {
		"Set-Cookie": `gaw_paid=${token}; Path=/; HttpOnly; Max-Age=2592000`,
		Location: redirectUrl,
	});
	res.end();
}

module.exports = http
	.createServer(async (req, res) => {
		try {
			const parsedUrl = url.parse(req.url, true);
			const hostUrl = `http://${req.headers.host}`;
			console.log(req.method, parsedUrl.path);

			// 1. Start Stripe Checkout (Cards, Apple Pay, Google Pay, Cash App Pay)
			if (parsedUrl.pathname === "/api/pay-stripe") {
				const checkoutUrl = await createStripeSession(hostUrl);
				res.writeHead(302, { Location: checkoutUrl });
				return res.end();
			}

			// 2. Verify Stripe Return
			if (parsedUrl.pathname === "/api/verify-stripe") {
				const token = await verifyStripeSession(parsedUrl.query.session_id);
				if (token) return setCookieAndRedirect(res, token, "/go_full");
				res.writeHead(400, { "Content-Type": "text/plain" });
				return res.end("Payment verification failed.");
			}

			// 3. Verify PayPal / Venmo Order
			if (req.method === "POST" && parsedUrl.pathname === "/api/verify-paypal") {
				let body = "";
				req.on("data", (chunk) => (body += chunk));
				req.on("end", async () => {
					const { orderID } = JSON.parse(body || "{}");
					const token = await verifyPayPalOrder(orderID);
					if (token) {
						res.writeHead(200, {
							"Content-Type": "application/json",
							"Set-Cookie": `gaw_paid=${token}; Path=/; HttpOnly; Max-Age=2592000`,
						});
						return res.end(JSON.stringify({ success: true }));
					}
					res.writeHead(400, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ success: false }));
				});
				return;
			}

			// 4. Verify Manual Access Code
			if (parsedUrl.pathname === "/api/verify-code") {
				const token = verifyAccessCode(parsedUrl.query.code);
				if (token) return setCookieAndRedirect(res, token, "/go_full");
				res.writeHead(403, { "Content-Type": "text/plain" });
				return res.end("Invalid access code.");
			}

			// 5. Block unpaid users from opening the video maker page
			if (parsedUrl.pathname === "/go_full") {
				const isPaid = await hasValidPaymentMethod(req);
				if (!isPaid) {
					res.writeHead(403, { "Content-Type": "text/html" });
					return res.end(`
						<!DOCTYPE html>
						<html>
						<head><title>Payment Required</title></head>
						<body style="font-family: sans-serif; text-align: center; padding: 40px; max-width: 420px; margin: auto;">
							<h1>Unlock Video Maker ($5.00)</h1>
							<p>Choose a payment method to start creating videos:</p>

							<a href="/api/pay-stripe" style="display: block; background: #635bff; color: white; padding: 14px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-bottom: 16px;">
								Pay with Card, Apple Pay, Google Pay, or Cash App
							</a>

							<div id="paypal-button-container" style="margin-bottom: 24px;"></div>

							<form action="/api/verify-code" method="GET" style="border-top: 1px solid #ddd; padding-top: 20px;">
								<input type="text" name="code" placeholder="Enter VIP / Access Code" required style="padding: 10px; width: 65%; border: 1px solid #ccc; border-radius: 4px;" />
								<button type="submit" style="padding: 10px 14px; background: #222; color: white; border: none; border-radius: 4px; cursor: pointer;">Unlock</button>
							</form>

							<script src="https://paypal.com{PAYPAL_CLIENT_ID}&currency=USD&enable-funding=venmo"></script>
							<script>
								paypal.Buttons({
									createOrder: function(data, actions) {
										return actions.order.create({
											purchase_units: [{ amount: { value: "5.00" } }]
										});
									},
									onApprove: function(data, actions) {
										return actions.order.capture().then(function() {
											fetch("/api/verify-paypal", {
												method: "POST",
												headers: { "Content-Type": "application/json" },
												body: JSON.stringify({ orderID: data.orderID })
											}).then(res => res.json()).then(result => {
												if (result.success) window.location.reload();
											});
										});
									}
								}).render("#paypal-button-container");
							</script>
						</body>
						</html>
					`);
				}
			}

			const found = functions.find((f) => f(req, res, parsedUrl));
			if (!found) {
				res.statusCode = 404;
				res.end();
			}
		} catch (x) {
			res.statusCode = 404;
			res.end();
		}
	})
	.listen(env.PORT || env.SERVER_PORT, console.log);
