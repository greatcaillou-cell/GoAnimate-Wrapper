module.exports = {
	hasValidPaymentMethod: async function (req) {
		// Replace this with your database/Stripe check later.
		// Currently returns false to block all unpaid saves.
		return false;
	}
};
