var MochiKit = loadInNewContext(["MochiKit/Base.js", "MochiKit/Async.js"]).MochiKit;
var SimilarImageFinder = loadInNewContext("libpuzzle.js").SimilarImageFinder;
var OAuth = loadInNewContext(["oauth.js", "sha1.js"]).OAuth;

load("tumblr-api.js");
load("tumblr.js");

var Async = MochiKit.Async;
var Deferred = Async.Deferred;
var DeferredList = Async.DeferredList;
var doXHR = Async.doXHR;

var ORIGIN = "http://www.tumblr.com";
var TITLE = "tumblr-liked";

var REBLOG_INTERVAL_SEC = 3;
var DOWNLOAD_INTERVAL_SEC = 0;
var READPOST_INTERVAL_SEC = 1;
var SIMILARITY_THRESHOLD = 0.2;

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

Object.defineProperty(__context__, "Config", {
	get: function() liberator.globalVariables.tumblrliked_config,
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

var GUI = function (funcToReadPost) {
	this.tumblr = new Tumblr();
	this.funcToReadPost = funcToReadPost;
	this.browser = null;
	this.doc = null;
	this.guiPosts = null;
};

GUI.start = function(funcToReadPost) {
	new GUI(funcToReadPost).start();
};

GUI.prototype.start = function() {
	this.browser = gBrowser.getBrowserForTab(gBrowser.addTab(""));
	this.browser.addEventListener("load", this._start_onTabLoad.bind(this), true);
};

GUI.prototype._start_onTabLoad = function(event) {
	this.doc = event.target;
	var html = <>
		<title>{TITLE}</title>
		<style type="text/css">
		  /*<![CDATA[*/
		  td.img { font-size: 30px; }
		  th { font-size: 20px; padding-left: 20px; padding-right: 20px; }
		  th, td { text-align: center; }
		  td.download { text-align: right; }
		  td.download .progress { display: inline-block; width: 100px; }
		  .done { background-color: #CDF4BE; }
		  button { font-size: 50px; }
		  button#run { padding-left: 30px; padding-right: 30px; }
		  p#status { min-height: 1em; }
		  /*]]>*/
		</style>
		<h1>{TITLE}</h1>
		Directory to save: <input type="text" size="40" id="directory"/><br/>
		<button disabled="disabled" id="run">Run!</button>
		<button disabled="disabled" id="cancel">Cancel</button>
		<p id="status"></p>
		<table>
		<thead><tr><th/><th>Reblog</th><th>Download</th></tr></thead>
		<tbody/>
		</table>
	</>;
	this.doc.documentElement.appendChild(this.toDOM(html));
	this.doc.querySelector("#directory").value = Config.directoryToSave;
	this.changeStatus("collecting posts ...");
	(this.funcToReadPost)(this.tumblr).addCallback(this._start_onReceivePosts.bind(this)).addErrback(liberator.echoerr);
};

GUI.prototype.changeStatus = function(text) {
	replaceElemText(this.doc.querySelector("#status"), text);
};

GUI.prototype._start_onReceivePosts = function(posts) {
	posts = posts.reverse(); // 古い順に
	var tbody = this.doc.querySelector("tbody");
	var self = this;
	var guiPosts = this.guiPosts = [];
	posts.forEach(function (post) {
		var guiPost = GUI.Post.build(self, post);
		tbody.appendChild(guiPost.tr);
		guiPosts.push(guiPost);
	});
	var button = this.doc.querySelector("button#run");
	button.disabled = false;
	button.addEventListener("click", this.run.bind(this), false);
	this.changeStatus("");
	if (false && Config.enabledDuplicateChecker)
		DuplicateChecker.start(this);
};

GUI.prototype.run = function() {
	var dir = this.doc.querySelector("#directory").value;
	var deferredList = new DeferredList([this.runReblog(), this.runDownload(dir)],
	                                    false, true, false,
		                            function(d) d.list.forEach(function(e) e.cancel()));
	this._run_changeGUIState(deferredList);
};

GUI.prototype._run_changeGUIState = function(deferred) {
	var self = this;
	var runButton = this.doc.querySelector("button#run");
	var cancelButton = this.doc.querySelector("button#cancel");
	runButton.disabled = true;
	cancelButton.disabled = false;

	var onClickCancelButton = function() {
		deferred.cancel();
		self.changeStatus("canceled");
		dispose();
	};
	var onUnload = function() {
		deferred.cancel();
	};
	cancelButton.addEventListener("click", onClickCancelButton, false);
	this.browser.contentWindow.addEventListener("unload", onUnload, false);

	this.changeStatus("runnning ...");
	deferred.addCallback(function() {
		dispose();
		self.changeStatus("finish!");
	});

	function dispose() {
		cancelButton.removeEventListener("click", onClickCancelButton);
		cancelButton.disabled = true;
		self.browser.contentWindow.removeEventListener("unload", onUnload);
	}
};

GUI.prototype.runReblog = function() {
	return this.doAsyncProcessEachPostsWithWait(function(guiPost) guiPost.reblog(),
	                                            REBLOG_INTERVAL_SEC);
};

GUI.prototype.runDownload = function(dir) {
	return this.doAsyncProcessEachPostsWithWait(function(guiPost) guiPost.download(dir),
	                                            DOWNLOAD_INTERVAL_SEC);
};

GUI.prototype.doAsyncProcessEachPostsWithWait = function(process, sec) {
	var first = true;
	return this.doAsyncProcessEachPosts(function(guiPost) {
		if (first) {
			first = false;
			return process(guiPost);
		} else {
			return Async.callLater(sec, process, guiPost);
		}
	});
};

GUI.prototype.doAsyncProcessEachPosts = function(process) {
	var guiPosts = this.guiPosts;
	return loop(0);
	function loop(index) {
		if (index >= guiPosts.length) return Async.succeed();
		var guiPost = guiPosts[index];
		return process(guiPost).addCallback(loop, index + 1);
	}
};

GUI.prototype.toDOM = function(xml) {
	return util.xmlToDom(xml, this.doc);
};

GUI.Post = function(tumblr, post, tr, reblogProgressElem, media) {
	this.tumblr = tumblr;
	this.post = post;
	this.tr = tr;
	this.reblogProgressElem = reblogProgressElem;
	this.media = media;
};

GUI.Post.build = function(gui, post) {
	var url = post.post_url;
	var tr = <tr><td class="img"/><td class="reblog"/><td class="download"/></tr>;
	var imgTd = tr.td[0];
	var dlTd = tr.td[2];
	var imgContainer = <a href={url}/>;
	imgTd.appendChild(imgContainer);

	var thumbnailURLs = post.getThumbnailURLs();
	thumbnailURLs.forEach(function(url)
		imgContainer.appendChild(<img src={url}/>));
	if (thumbnailURLs.length === 0) {
		imgContainer.appendChild("(" + post.type + ")");
	}

	var mediaURLs = post.getMediaURLs();
	mediaURLs.forEach(function (url) {
		var fileName = getDefaultFileName(null, makeURI(url));
		dlTd.appendChild(<><a href={url}>{fileName}</a><span class="progress"></span><br/></>);
	});
	if (mediaURLs.length === 0) {
		dlTd.appendChild(<>(None)<span class="progress"></span></>);
	}

	var trNode = gui.toDOM(tr);
	var reblogProgressElem = trNode.childNodes[1];
	var downloadProgressElems = trNode.querySelectorAll("td.download .progress");
	var media = mediaURLs.map(function (url, i) {
		return {
			url: url,
			progressElem: downloadProgressElems[i]
		};
	});

	return new GUI.Post(gui.tumblr, post, trNode, reblogProgressElem, media);
};

GUI.Post.prototype.reblog = function() {
	var self = this;
	var progress = this.reblogProgressElem;
	replaceElemText(progress, "Reblogging...");
	return this.tumblr.reblogByPost(this.post).addCallback(function() {
		replaceElemText(progress, "Reblogged");
		progress.classList.add("done");
	});
};

GUI.Post.prototype.download = function(dir) {
	var self = this;
	var failed = false;
	function loop(index) {
		if (index >= self.media.length) return Async.succeed();
		var m = self.media[index];
		return download(m.url, dir, progress).addCallback(function (success) {
			if (success) {
				replaceElemText(m.progressElem, "complete");
				m.progressElem.classList.add("done");
			} else {
				replaceElemText(m.progressElem, "failed");
				failed = true;
			}
			return loop(index + 1);
		});
		function progress(cur, max) {
			replaceElemText(m.progressElem, (cur / max * 100).toFixed(1) + " %");
		}
	}
	return loop(0).addCallback(function() {
		if (!failed) {
			self.tr.querySelector("td.download").classList.add("done");
		}
	});
};

function DuplicateChecker(gui) {
	this.gui = gui;
	this.outputElem = null;
}

DuplicateChecker.start = function(gui) {
	new DuplicateChecker(gui).start();
};

DuplicateChecker.prototype.start = function() {
	var xml = <div id="duplicate-checker">
		<h2>Duplicate Checker</h2>
		<p class="status"/>
		<div class="result"/>
	</div>;
	var style = <style type="text/css">
		/*<![CDATA[*/
		#duplicate-checker {
			border: 1px solid black;
			margin: 5px;
			padding: 5px;
		}
		/*]]>*/
	</style>
	var doc = this.gui.doc;
	var h1 = doc.querySelector("h1");
	this.outputElem = util.xmlToDom(xml, doc);
	h1.parentNode.insertBefore(this.outputElem, h1.nextSibling);
	doc.documentElement.appendChild(util.xmlToDom(style, doc));
	this.changeStatus("collectings images...");
	this.collectImages().addCallback(this.checkDuplicate.bind(this)).addErrback(liberator.echoerr);
};

DuplicateChecker.prototype.collectImages = function() {
	var self = this;
	return this.collectBlogImagesAndBuildFinder().addCallback(function ([finder, blogPosts]) {
		return self.loadLikedImages().addCallback(function (likedImages) {
			return [finder, blogPosts, likedImages];
		});
	});
}

DuplicateChecker.prototype.loadLikedImages = function() {
	var list = [];
	var result = [];
	this.gui.posts.forEach(function (post, i) {
		result[i] = [];
		detectThumbnailURLs(post.postElem).forEach(function (url, j) {
			list.push(loadImage(url).addCallback(function (binary) {
				result[i][j] = binary;
			}));
		})
	});
	return doParallel(list).addCallback(function () result);
};

DuplicateChecker.prototype.checkDuplicate = function([finder, blogPosts, likedImages]) {
	this.changeStatus("checking duplicate");
	var result = this.findDuplicate(finder, this.gui.posts, likedImages);
	var output = <div/>;
	result.forEach(function(res) {
		detectThumbnailURLs(res.likedPost.postElem).forEach(function(url) {
			output.appendChild(<img src={url}/>);
		});
		res.blogPost.getThumbnailURLs().forEach(function(url) {
			output.appendChild(<img src={url}/>);
		});
		output.appendChild(<br/>);
	});
	replaceElemChild(this.outputElem.querySelector("div.result"), this.gui.toDOM(output.children()));
	finder.close();
};

DuplicateChecker.prototype.findDuplicate = function(finder, likedPosts, likedImages) {
	var likedPosts = this.gui.posts;
	var result = [];
	likedPosts.forEach(function (likedPost, index) {
		likedImages[index].forEach(function (image) {
			finder.findByBinary(image, SIMILARITY_THRESHOLD).forEach(function (res) {
				result.push({dist: res.dist,
				             likedPost: likedPost,
				             blogPost: res.image.meta.post});
			});
		});
	});
	return result;
};

DuplicateChecker.prototype.changeStatus = function(text) {
	replaceElemText(this.outputElem.querySelector("p.status"), text);
};

DuplicateChecker.prototype.collectBlogImagesAndBuildFinder = function() {
	var finder = new SimilarImageFinder();
	return readBlogPosts(Config.blogName).addCallback(function (posts) {
		var images = [];
		Array.forEach(posts, function (post) {
			post.getThumbnailURLs().forEach(function (imageUrl) {
				images.push([post, imageUrl]);
			});
		});
		var list = images.map(function ([post, imageUrl]) {
			liberator.log(imageUrl);
			return loadImage(imageUrl)
				.addCallback(function (binary) {
					var meta = {imageUrl: imageUrl, post: post};
					finder.add(meta, binary);
				});
		});
		return new DeferredList(list, false, true, false).addCallback(function() {
			return [finder, posts];
		});
	});
}

function formToKeyValueStore(form) {
	var elems = form.querySelectorAll("input, textarea, select");
	var store = {};
	Array.forEach(elems, function(elem) {
		store[elem.name] = elem.value;
	});
	return store;
}

function toQueryString(store) {
	var query = [];
	for (var key in store) {
		query.push(encodeURIComponent(key) + "=" + encodeURIComponent(store[key]));
	}
	return query.join("&");
}

function replaceElemText(node, text) {
	var doc = node.ownerDocument;
	node.innerHTML = "";
	node.appendChild(doc.createTextNode(text));
}

function replaceElemChild(node, child) {
	node.innerHTML = "";
	node.appendChild(child);
}

function genRegexp(strings) {
	return new RegExp("^(?:" + Array.map(strings, function(str)
					str.replace(/\W/g,'\\$&')).join("|") + ")$");
}

function toAbsoluteURL(url, base) {
	return makeURI(url, null, makeURI(base)).spec;
}

function doParallel(list) {
	var canceler = function(d) d.list.forEach(function(e) e.cancel());
	return new DeferredList(list, false, true, false, canceler);
}

function newTab() {
	var browser = gBrowser.getBrowserForTab(gBrowser.addTab(""));
	var deferred = new Deferred();
	browser.addEventListener("load", callback, true);
	return deferred;

	function callback() {
		deferred.callback(browser);
	}
}

function loadImage(url) {
	var req = new XMLHttpRequest();
	req.open("GET", url, true);
	req.responseType = "arraybuffer";
	return Async.sendXMLHttpRequest(req, null).addCallback(function()
		new Uint8Array(req.response));
}

function download(url, dir, progress) {
	var uri = makeURI(url);
	var fileName = getDefaultFileName(null, uri);
	var persist = makeWebBrowserPersist();
	var file = services.create("file");
	file.initWithPath(dir);
	file.appendRelativePath(fileName);
	// 同名ファイルがあるときファイル名をかえる
	//  (ちなみにpersistFlagsからPERSIST_FLAGS_REPLACE_EXISTING_FILESを
	//   取り除いてみても変化なく、上書きされた)
	file = uniqueFile(file);
	var fileuri = makeFileURI(file);

	var downloadManager = Cc["@mozilla.org/download-manager;1"].getService(Ci.nsIDownloadManager);
	var download = downloadManager.addDownload(0, uri, fileuri, null, null, null, null, persist);
	persist.progressListener = {
		onProgressChange: onProgressChange,
		onStateChange: onStateChange
	};
	var deferred = new Deferred();
	persist.saveURI(uri, null, null, null, null, file);
	deferred.canceller = function() {
		// onStateChangeのdeferred.callbackが呼ばれるのを防ぐ
		persist.progressListener = null;

		if (download.state === downloadManager.DOWNLOAD_DOWNLOADING) {
			downloadManager.cancelDownload(download.id);
		}
	};
	return deferred;

	function onProgressChange(aWebProgress, aRequest, aCurSelfProgress, aMaxSelfProgress, aCurTotalProgress, aMaxTotalProgress) {
		download.onProgressChange.apply(this, arguments);
		if (progress) progress(aCurTotalProgress, aMaxTotalProgress);
	}
	function onStateChange(aWebProgress, aRequest, aStateFlags, aStatus) {
		download.onStateChange.apply(this, arguments);
		if (aStateFlags & Ci.nsIWebProgressListener.STATE_STOP) {
			deferred.callback(aStatus === 0);
		}
	}
}

// libly.Response#getHTMLDocumentを使うと相対リンクで問題が起こるため
// TomblooのconvertToHTMLDocumentで代用
//
// from https://github.com/to/tombloo/blob/master/xpi/chrome/content/library/01_utility.js
function convertToHTMLDocument(html, doc) {
	html = html.replace(/<!DOCTYPE.*?>/, '').replace(/<html.*?>/, '').replace(/<\/html>.*/, '');
	
	doc = doc || content.document;
	// doc = doc || currentDocument() || document;
	var xsl = (new DOMParser()).parseFromString(
		'<?xml version="1.0"?>\
			<stylesheet version="1.0" xmlns="http://www.w3.org/1999/XSL/Transform">\
			<output method="html"/>\
		</stylesheet>', 'text/xml');
	
	var xsltp = new XSLTProcessor();
	xsltp.importStylesheet(xsl);
	
	doc = xsltp.transformToDocument(doc.implementation.createDocument('', '', null));
	doc.appendChild(doc.createElement('html'));
	
	var range = doc.createRange();
	range.selectNodeContents(doc.documentElement);
	doc.documentElement.appendChild(range.createContextualFragment(html));
	
	return doc
}

