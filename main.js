var MochiKit = loadInNewContext(["MochiKit/Base.js", "MochiKit/Async.js"]).MochiKit;
var {SimilarImageFinder, Puzzle} = loadInNewContext("libpuzzle.js");
var OAuth = loadInNewContext(["oauth.js", "sha1.js"]).OAuth;

load("utils.js");
load("tumblr-api.js");
load("tumblr.js");
load("gui.js");
load("duplicate-checker.js");

var Async = MochiKit.Async;
var Deferred = Async.Deferred;
var DeferredList = Async.DeferredList;

var TITLE = "tumblr-liked";

/*
Example:
liberator.globalVariables.tumblrliked_config = {
	baseHostname: "<blog name>.tumblr.com",
	directoryToSave: "~/tmp",
	enabledDuplicateChecker: false,
	oauthAccessor: {
		consumerKey    : "<consumer key>",
		consumerSecret : "<consumer secret>",
		token          : "<access token>",
		tokenSecret    : "<access token secret>",
	},
};
*/
Object.defineProperty(__context__, "Config", {
	get: function () liberator.globalVariables.tumblrliked_config,
	configurable: true
});

commands.add(
	["tumblrliked"],
	"Reblog and Download tumblr liked posts",
	function (args) {
		var arg = args[0];
		var num = arg && /^\d+$/.test(arg) ? Number(arg) : null;
		commandTumblrLiked(num);
	},
	{argCount: "?"}, true);

function commandTumblrLiked(num) {
	var funcToReadPost;
	if (typeof num == "number") {
		funcToReadPost = function (tumblr) tumblr.readLikedPosts(num);
	} else {
		funcToReadPost = function (tumblr) tumblr.readLikedPostsUntilEncounterReblogged();
	}
	GUI.start(funcToReadPost);
}

function loadInNewContext(filenames) {
	return loadGeneric(filenames, {});
}

function load(filenames) {
	return loadGeneric(filenames, __context__);
}

function loadGeneric(filenames, context) {
	filenames = [].concat(filenames);
	var dir = File(__context__.PATH).parent.path;

	filenames.forEach(function (filename) {
		var file = File.joinPaths(dir, filename);
		var uri = services.get("io").newFileURI(file).spec;
		liberator.loadScript(uri, context);
	});
	return context;
}

