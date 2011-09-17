var path = File.joinPaths(File(__context__.PATH).parent.path, "main.js").path;
io.source(path);
window.t = plugins.contexts[path];

with(t) {
	TITLE += " (DEBUG)";
	// デバッグ中サーバーに負荷をかけないようにcacheする
	var orig = Async.sendXMLHttpRequest;
	Async.sendXMLHttpRequest = function(req, body) {
		if (!t.CACHE) t.CACHE = {};
		var CACHE = t.CACHE;
		if (req.channel.URI.host !== "api.tumblr.com") {
			return orig.apply(this, arguments);
		}
		var url = req.channel.URI.spec;
		if (CACHE[url]) {
			liberator.log("CACHE HIT: "+url);
			return Async.wait(0, CACHE[url]);
		}
		return orig.apply(this, arguments).addCallback(function (req) {
			CACHE[url] = req;
			liberator.log("CACHE STORE: "+url);
			return req;
		});
	};
	// リブログは実際に行わない
	Tumblr.prototype.reblogByPost = function (post) {
		liberator.log("[DUMMY] reblogging "+post.post_url);
		return Async.wait(0);
	};
	REBLOG_INTERVAL_SEC = 0.5;
	DOWNLOAD_INTERVAL_SEC = 2;
	Tumblr.Post.prototype.getMediaURLs = Tumblr.Post.prototype.getThumbnailURLs;
	commandTumblrLiked();
}


