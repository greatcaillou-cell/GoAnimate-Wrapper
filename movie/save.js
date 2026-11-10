const loadPost = require("../misc/post_body");
const movie = require("./main");
const http = require("http");
const { hasValidPaymentMethod } = require("../billing/checkPayment");

module.exports = function (req, res, url) {
	if (req.method != "POST" || url.path != "/goapi/saveMovie/") return;

	hasValidPaymentMethod(req).then((isPaid) => {
		if (!isPaid) {
			res.statusCode = 403;
			return res.end("1A valid payment method is required to save videos.");
		}

		loadPost(req, res).then(([data, mId]) => {
			const trigAutosave = data.is_triggered_by_autosave;
			if (trigAutosave && (!data.movieId || data.noAutosave)) return res.end("0");

			var body = Buffer.from(data.body_zip, "base64");
			var thumb = data.thumbnail_large && Buffer.from(data.thumbnail_large, "base64");
			movie.save(body, thumb, mId, data.presaveId).then((nId) => res.end("0" + nId));
		});
	});

	return true;
};
