
wholeBlock: {

if (!plugins.libly) {
	liberator.echoerr(__context__.NAME + ": Please install _libly.js.");
	break wholeBlock;
}

if (!window.MochiKit) {
	commandline.echo(<>{__context__.NAME}:<br/>
	                  Please download MochiKit.js,<br/>
	                  and save as _MochiKit.js into the plugin directory<br/>
	                  <a href="http://mochi.github.com/mochikit/">http://mochi.github.com/mochikit/</a></>,
	                commandline.HL_ERRORMSG, commandline.APPEND_TO_MESSAGES);
	break wholeBlock;
}

var libly = plugins.libly;
var Async = window.MochiKit.Async;
var Deferred = Async.Deferred;
var DeferredList = Async.DeferredList;
var doXHR = Async.doXHR;
var SimularImageFinder = plugins.libpuzzle.SimularImageFinder;

var ORIGIN = "http://www.tumblr.com";
var TITLE = __context__.NAME;

var DEFAULT_POSTS_NUM = 5;
var REBLOG_INTERVAL_SEC = 3;
var DOWNLOAD_INTERVAL_SEC = 0;
var READPOST_INTERVAL_SEC = 1;
var SIMILALY_THRESHOLD = 0.2;

commands.add(
	["tumblrliked"],
	"Reblog and Download tumblr liked posts",
	function (args) {
		var arg = args[0];
		var num = arg && /^\d+$/.test(arg) ? Number(arg) : null;
		var funcToReadPost;
		if (num !== null) {
			funcToReadPost = readLikedPosts.bind(null, num);
		} else if (content.location.href.indexOf(ORIGIN+"/tumblelog/") === 0) {
			funcToReadPost = readLikedPostsWithTumblelogDocument.bind(null, content.document);
		}
		GUI.start(funcToReadPost);
	},
	{argCount: "?"}, true);

if (__context__.DEBUG) {
	setTimeout(function() {
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
		detectMediaURLs = detectThumbnailURLs;
		//GUI.start();
		startDuplicateCheck();
	});
}

var GUI = function (funcToReadPost) {
	this.funcToReadPost = funcToReadPost || readLikedPosts.bind(null, DEFAULT_POSTS_NUM);
	this.browser = null;
	this.doc = null;
	this.posts = null;
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
	this.doc.querySelector("#directory").value = this.getDefaultDirectory();
	this.changeStatus("collecting posts ...");
	(this.funcToReadPost)().addCallback(this._start_onReceivePosts.bind(this));
};

GUI.prototype.getDefaultDirectory = function() {
	return liberator.globalVariables.tumblrliked_dir || io.getCurrentDirectory().path;
};

GUI.prototype.changeStatus = function(text) {
	replaceElemText(this.doc.querySelector("#status"), text);
};

GUI.prototype._start_onReceivePosts = function(postElems) {
	postElems = postElems.reverse(); // 古い順に
	var tbody = this.doc.querySelector("tbody");
	var self = this;
	var posts = this.posts = [];
	postElems.forEach(function (postElem) {
		var post = GUI.Post.build(self, postElem);
		tbody.appendChild(post.tr);
		posts.push(post);
	});
	var button = this.doc.querySelector("button#run");
	button.disabled = false;
	button.addEventListener("click", this.run.bind(this), false);
	this.changeStatus("");
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
	return this.doAsyncProcessEachPostsWithWait(function(post) post.reblog(),
	                                            REBLOG_INTERVAL_SEC);
};

GUI.prototype.runDownload = function(dir) {
	return this.doAsyncProcessEachPostsWithWait(function(post) post.download(dir),
	                                            DOWNLOAD_INTERVAL_SEC);
};

GUI.prototype.doAsyncProcessEachPostsWithWait = function(process, sec) {
	var first = true;
	return this.doAsyncProcessEachPosts(function(post) {
		if (first) {
			first = false;
			return process(post);
		} else {
			return Async.callLater(sec, process, post);
		}
	});
};

GUI.prototype.doAsyncProcessEachPosts = function(process) {
	var posts = this.posts;
	return loop(0);
	function loop(index) {
		if (index >= posts.length) return Async.succeed();
		var post = posts[index];
		return process(post).addCallback(loop, index + 1);
	}
};

GUI.prototype.toDOM = function(xml) {
	return util.xmlToDom(xml, this.doc);
};

GUI.Post = function(postElem, tr, reblogProgressElem, media) {
	this.postElem = postElem;
	this.tr = tr;
	this.reblogProgressElem = reblogProgressElem;
	this.media = media;
};

GUI.Post.build = function(gui, postElem) {
	var url = getPermalinkURL(postElem);
	var tr = <tr><td class="img"/><td class="reblog"/><td class="download"/></tr>;
	var imgTd = tr.td[0];
	var dlTd = tr.td[2];
	var imgContainer = <a href={url}/>;
	imgTd.appendChild(imgContainer);

	var thumbnailURLs = detectThumbnailURLs(postElem);
	thumbnailURLs.forEach(function(url)
		imgContainer.appendChild(<img src={url}/>));
	if (thumbnailURLs.length === 0) {
		imgContainer.appendChild("(" + getPostType(postElem) + ")");
	}

	var mediaURLs = detectMediaURLs(postElem);
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

	return new GUI.Post(postElem, trNode, reblogProgressElem, media);
};

GUI.Post.prototype.reblog = function() {
	var self = this;
	var progress = this.reblogProgressElem;
	replaceElemText(progress, "Reblogging...");
	return reblog(this.postElem).addCallback(function() {
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

function startDuplicateCheck() {
	collectImagesAndBuildFinder(getOpenedTumblelogName())
	.addCallback(function ([finder, posts]) {
		return newTab()
			.addCallback(function (browser) [browser, finder, posts]);
	}).addCallback(function ([browser, finder, posts]) {
		var doc = browser.contentDocument;
		var html = <html>
			<p>from {posts.length} posts</p>
			<table><tbody/></table>
		</html>;
		var tbody = html.table.tbody;
		var results = finder.findAll(SIMILALY_THRESHOLD);
		results.forEach(function ([image1, image2, dist]) {
			var tr = <tr/>;
			tbody.appendChild(tr);
			tr.appendChild(<td>{dist.toFixed(3)}</td>);
			[image1, image2].forEach(function (image) {
				var post = image.meta.post;
				var a = <a href={post.url}/>;
				var date = new Date(post["date"]);
				var dateStr = libly.$U.dateFormat(date);
				a.appendChild(<>{dateStr}<br/></>);
				post.getThumbnailURLs().forEach(function (imageUrl) {
					a.appendChild(<img src={imageUrl}/>);
				});
				tr.appendChild(<td>{a}</td>);
			});
		});
		if (results.length === 0) {
			html.appendChild(<p>duplicate posts not found!</p>);
		}
		doc.documentElement.appendChild(util.xmlToDom(html.children(), doc));
		finder.close();
	}).addErrback(liberator.echoerr);
}

function getOpenedTumblelogName() {
	var url = content.location.href;
	if (url.indexOf(ORIGIN + "/tumblelog/") === 0) {
		return url.match(/\/tumblelog\/([\w-]+)/)[1];
	} else {
		throw "open tumblelog page";
	}
}

function collectImagesAndBuildFinder(blogName) {
	var finder = new SimularImageFinder();
	var num = 0;
	return readBlogPosts(blogName).addCallback(function (posts) {
		var images = [];
		Array.forEach(posts, function (post) {
			num ++;
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

function PostDataFromAPI(data) {
	libly.$U.extend(this, data);
}

PostDataFromAPI.prototype.getThumbnailURLs = function() {
	if (this.type !== "photo") return [];
	var photos = this.photos.length > 0 ? this.photos : [this];
	return photos.map(function(photo) photo["photo-url-100"]);
};

function readBlogPosts(name) {
	var posts = [];
	function loop() {
		var url = "http://"+name+".tumblr.com/api/read/json?start="+posts.length+"&num=50";
		liberator.log(url);
		return doXHR(url).addCallback(function (res) {
			var json = res.responseText.replace(/^var tumblr_api_read = |;\s*$/g, "");
			var data = JSON.parse(json);
			data.posts.forEach(function (post) {
				posts.push(new PostDataFromAPI(post));
			});
			if (posts.length < Number(data["posts-total"])) {
				return Async.callLater(READPOST_INTERVAL_SEC, loop);
			} else {
				return Async.succeed(posts);
			}
		});
	}
	return loop();
}

// documentに含まれる自分のリブログポストの元ポストが出現するまでのポストを集める
// 自分のtumblelogのdocumentを指定して、
// 既にリブログ済みのポストに到達するまでーということをやるために
function readLikedPostsWithTumblelogDocument(doc) {
	var posts = doc.querySelectorAll("#posts .post.is_reblog.is_mine");
	var urls = Array.map(posts, function(post)
		post.querySelector(".post_info a").getAttribute("href"));
	var urlsRegexp = new RegExp("^(?:" + Array.map(urls, function(url)
					url.replace(/\W/g,'\\$&')).join("|") + ")");
	return readLikedPostsWithPredicate(function (allPosts, post)
		urlsRegexp.test(getPermalinkURL(post)));
}

function readLikedPosts(num) {
	var predicate = function(allPosts, post) allPosts.length >= num;
	return readLikedPostsWithPredicate(predicate);
}

function readLikedPostsWithPredicate(predicate) {
	var allPosts = [];
	return loop(1);
	function loop(page) {
		return doXHR(ORIGIN + "/likes/page/" + page).addCallback(function (res) {
			var doc = convertToHTMLDocument(res.responseText);
			var posts = doc.querySelectorAll("#posts .post");
			
			for (var i = 0; i < posts.length; i ++) {
				if (predicate(allPosts, posts[i])) {
					break;
				}
				allPosts.push(posts[i]);
			}
			if (i < posts.length || !doc.querySelector("#next_page_link")) {
				return Async.succeed(allPosts);
			} else {
				return loop(page + 1);
			}
		});
	}
}

function reblogAll(posts) {
	return loop(0);
	function loop(index) {
		if (index >= posts.length) return Async.succeed();
		return reblog(posts[index]).addCallback(loop, index + 1);
	}
}

function reblog(postElem) {
	var anchors = postElem.querySelectorAll("a");
	var reblogAnchor = Array.filter(anchors, function(a)
			     /^\/reblog\//.test(a.getAttribute("href")))[0];
	var reblogURL = ORIGIN + reblogAnchor.getAttribute("href");
	return reblogByURL(reblogURL);
}

function reblogByURL(reblogURL) {
	liberator.log("reblogging "+reblogURL);
	var redirect_to;
	return doXHR(reblogURL).addCallback(function(res) {
		var doc = convertToHTMLDocument(res.responseText);
		var form = doc.querySelector("form#edit_post");
		var store = formToKeyValueStore(form);
		redirect_to = form.redirect_to;
		delete store.preview_post;
		var data = toQueryString(store);
		return doXHR(reblogURL, {method: "POST", sendContent: data});
	}).addCallback(function(res) {
		if (res.channel.URI.spec.indexOf(ORIGIN + redirect_to)) {
			liberator.log("reblog success: "+reblogURL);
		} else {
			throw new Error("post failed: "+res.transport.channel.URI.spec);
		}
	});
}

function detectThumbnailURLs(postElem) {
	if (getPostType(postElem) !== "photo") return [];
	return Array.map(postElem.querySelectorAll("img"), function(img) {
		var url = img.getAttribute("src")
		return url.replace(/_(250|500)\./, "_100.")
	});
}

function detectMediaURLs(postElem) {
	if (postElem.classList.contains("photo")) {
		return detectPhotoURLs(postElem);
	} else if (postElem.classList.contains("video")) {
		return detectVideoURLs(postElem);
	} else {
		return [];
	}
}

function detectPhotoURLs(postElem) {
	var urls = [];
	var highResLink = postElem.querySelector("a[id^=high_res_link_]");
	if (highResLink) {
		urls.push(highResLink.getAttribute("href"));
	} else if (postElem.querySelector(".photoset_row")) {
		Array.forEach(postElem.querySelectorAll(".photoset_row a"), function(a) {
			urls.push(a.getAttribute("href"));
		});
	} else {
		Array.forEach(postElem.querySelectorAll("img.image_thumbnail"), function(img) {
			var onload = img.getAttribute("onload");
			urls.push(onload.match(/this.src='([^']+)'/)[1]);
		});
	}
	return urls;
}

function detectVideoURLs(postElem) {
	var script = postElem.querySelector("span[id^=video_player_] + script");
	if (!script) return [];
	var matched = script.textContent.match(/^renderVideo\("[^"]+",'([^']+)'/);
	return matched ? [matched[1]] : [];
}

function getPermalinkURL(postElem) {
	return postElem.querySelector("a[id^=permalink_]").getAttribute("href");
}

function getPostType(postElem) {
	var typesRegexp = /\b(text|quote|link|answer|video|audio|photo|regular)\b/;
	var matched = postElem.className.match(typesRegexp);
	return matched && matched[0];
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

function toAbsoluteURL(url, base) {
	return makeURI(url, null, makeURI(base)).spec;
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

}
