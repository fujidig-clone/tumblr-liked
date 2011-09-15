var path = File("~/.vimperator/plugin/tumblr-liked.js").path;
io.source(path);
window.t = plugins.contexts[path];

with(t) {
	TITLE += " (DEBUG)";
	// デバッグ中サーバーに負荷をかけないようにcacheする
	doXHR = function(url, opts) {
		if (!__context__.CACHE) __context__.CACHE = {};
		var CACHE = __context__.CACHE;
		if (CACHE[url]) {
			liberator.log("CACHE HIT: "+url);
			return Async.wait(0, CACHE[url]);
		}

		var d = Async.doXHR(url, opts);
		return d.addCallback(function(res) {
			CACHE[url] = res;
			liberator.log("CACHE STORE: "+url);
			return res;
		});
	};
	// リブログは実際に行わない
	reblogByURL = function(reblogURL) {
		liberator.log("[DUMMY] reblogging "+reblogURL);
		return Async.wait(0);
	};
	REBLOG_INTERVAL_SEC = 0.5;
	DOWNLOAD_INTERVAL_SEC = 2;
	READPOST_INTERVAL_SEC = 0;
	detectMediaURLs = detectThumbnailURLs;
	commandTumblrLiked();
}
