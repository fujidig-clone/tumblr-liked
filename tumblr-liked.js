var libly = liberator.plugins.libly;

var ORIGIN = "http://www.tumblr.com";
var TITLE = __context__.NAME;

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
		} else {
			liberator.echoerr("Specify number arguments or open tumblelog page beforehand.");
		}
		GUI.start(funcToReadPost);
	},
	{argCount: "?"}, true);

if (__context__.DEBUG) {
	TITLE += " (DEBUG)";
	setTimeout(function() { GUI.start() });
	// デバッグ中サーバーに負荷をかけないようにcacheする
	accessPage = function(url, opts, cont) {
		if (!__context__.CACHE) __context__.CACHE = {};
		var CACHE = __context__.CACHE;
		if (CACHE[url]) {
			liberator.log("CACHE HIT: "+url);
			setTimeout(function() cont(CACHE[url]));
			return;
		}

		var req = new libly.Request(url, {}, opts);
		req.addEventListener("onSuccess", function(res) {
			CACHE[url] = res;
			liberator.log("CACHE STORE: "+url);
			cont(res);
		});
		req.addEventListener("onFailure", function() {
			throw new Error("failed to access " + url);
		});
		req._request(opts.method || "GET");
	};
	// リブログは実際に行わない
	reblogByURL = function(reblogURL, cont) {
		liberator.log("[DUMMY] reblogging "+reblogURL);
		setTimeout(cont, 50);
	};
}

var GUI = function (funcToReadPost) {
	this.funcToReadPost = funcToReadPost || readLikedPosts.bind(null, 5);
	this.doc = null;
	this.posts = null;
};

GUI.start = function(funcToReadPost) {
	new GUI(funcToReadPost).start();
};

GUI.prototype.start = function() {
	var tab = gBrowser.getBrowserForTab(gBrowser.addTab(""));
	tab.addEventListener("load", this._start_onTabLoad.bind(this), true);
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
		  button { font-size: 50px };
		  /*]]>*/
		</style>
		<h1>{TITLE}</h1>
		Directory to save: <input type="text" size="40" id="directory"/><br/>
		<button disabled="disabled">Run!</button>
		<table>
		<thead><tr><th/><th>Reblog</th><th>Download</th></tr></thead>
		<tbody/>
		</table>
	</>;
	this.doc.documentElement.appendChild(this.toDOM(html));
	this.doc.querySelector("#directory").value = this.getDefaultDirectory();
	(this.funcToReadPost)(this._start_onReceivePosts.bind(this));
};

GUI.prototype.getDefaultDirectory = function() {
	return liberator.globalVariables.tumblrliked_dir || io.getCurrentDirectory().path;
}

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
	var button = this.doc.querySelector("button");
	button.disabled = false;
	button.addEventListener("click", this.run.bind(this), false);
};

GUI.prototype.run = function() {
	var dir = this.doc.querySelector("#directory").value;
	this.runReblog();
	this.runDownload(dir);
};

GUI.prototype.runReblog = function() {
	this.doAsyncProcessEachPosts(function(post, k) post.reblog(k));
};

GUI.prototype.runDownload = function(dir) {
	this.doAsyncProcessEachPosts(function(post, k) post.download(dir, k));
};

GUI.prototype.doAsyncProcessEachPosts = function(process) {
	var posts = this.posts;
	loop(0);
	function loop(index) {
		if (index >= posts.length) {
			return;
		}
		var post = posts[index];
		process(post, function() loop(index + 1));
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

GUI.Post.prototype.reblog = function(cont) {
	var self = this;
	var progress = this.reblogProgressElem;
	replaceElemText(progress, "Reblogging...");
	reblog(this.postElem, function() {
		replaceElemText(progress, "Reblogged");
		progress.classList.add("done");
		cont();
	});
};

GUI.Post.prototype.download = function(dir, cont) {
	var self = this;
	var failed = false;
	asyncEach(this.media, function(m, k) {
		download(m.url, dir, progress, function (success) {
			if (success) {
				replaceElemText(m.progressElem, "complete");
				m.progressElem.classList.add("done");
			} else {
				replaceElemText(m.progressElem, "failed");
				failed = true;
			}
			k();
		});
		function progress(cur, max) {
			replaceElemText(m.progressElem, (cur / max * 100).toFixed(1) + " %");
		}
	}, function() {
		if (!failed) {
			self.tr.querySelector("td.download").classList.add("done");
		}
		cont();
	});
};

// documentに含まれる自分のリブログポストの元ポストが出現するまでのポストを集める
// 自分のtumblelogのdocumentを指定して、
// 既にリブログ済みのポストに到達するまでーということをやるために
function readLikedPostsWithTumblelogDocument(doc, cont) {
	var posts = doc.querySelectorAll("#posts .post.is_reblog.is_mine");
	var urls = Array.map(posts, function(post)
		post.querySelector(".post_info a").getAttribute("href"));
	var urlsRegexp = new RegExp("^(?:" + Array.map(urls, function(url)
					url.replace(/\W/g,'\\$&')).join("|") + ")");
	readLikedPostsWithPredicate(function (allPosts, post)
		urlsRegexp.test(getPermalinkURL(post)), cont);
}

function readLikedPosts(num, cont) {
	var predicate = function(allPosts, post) allPosts.length >= num;
	readLikedPostsWithPredicate(predicate, cont);
}

function readLikedPostsWithPredicate(predicate, cont) {
	var allPosts = [];
	loop(1);
	function loop(page) {
		accessPage(ORIGIN + "/likes/page/" + page, {}, function(res) {
			var doc = convertToHTMLDocument(res.responseText);
			var posts = doc.querySelectorAll("#posts .post");
			
			for (var i = 0; i < posts.length; i ++) {
				if (predicate(allPosts, posts[i])) {
					break;
				}
				allPosts.push(posts[i]);
			}
			if (i < posts.length || !doc.querySelector("#next_page_link")) {
				cont(allPosts);
			} else {
				loop(page + 1);
			}
		});
	}
}

function reblogAll(posts, cont) {
	var index = 0;
	loop();
	function loop() {
		if (index >= posts.length) {
			cont();
		}
		reblog(posts[index++], loop);
	}
}

function reblog(postElem, cont) {
	var anchors = postElem.querySelectorAll("a");
	var reblogAnchor = Array.filter(anchors, function(a)
			     /^\/reblog\//.test(a.getAttribute("href")))[0];
	var reblogURL = ORIGIN + reblogAnchor.getAttribute("href");
	reblogByURL(reblogURL, cont);
}

function reblogByURL(reblogURL, cont) {
	liberator.log("reblogging "+reblogURL);
	var redirect_to;
	accessPage(reblogURL, {}, function(res) {
		var doc = convertToHTMLDocument(res.responseText);
		var form = doc.querySelector("form#edit_post");
		var store = formToKeyValueStore(form);
		redirect_to = form.redirect_to;
		delete store.preview_post;
		var data = toQueryString(store);
		accessPage(reblogURL, {method: "POST", postBody: data}, onReceivePostResponse);
	});
	function onReceivePostResponse(res) {
		if (res.transport.channel.URI.spec.indexOf(ORIGIN + redirect_to)) {
			liberator.log("reblog success: "+reblogURL);
			cont();
		} else {
			throw new Error("post failed: "+res.transport.channel.URI.spec);
		}
	}
}

function downloadPosts(posts, dir) {
	posts.forEach(function (post) {
		detectPhotoURLs(post).forEach(function (url) {
			download(url, dir);
		});
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
	var typesRegexp = /\b(text|quote|link|answer|video|audio|photo)\b/;
	return postElem.className.match(typesRegexp)[0];
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

function accessPage(url, opts, cont) {
	var req = new libly.Request(url, {}, opts);
	req.addEventListener("onSuccess", cont);
	req.addEventListener("onFailure", function() {
		throw new Error("failed to access " + url);
	});
	req._request(opts.method || "GET");
}

function replaceElemText(node, text) {
	var doc = node.ownerDocument;
	node.innerHTML = "";
	node.appendChild(doc.createTextNode(text));
}

function asyncEach(array, callback, cont) {
	loop(0);
	function loop(index) {
		if (index >= array.length) {
			cont();
		} else {
			callback(array[index], function() loop(index + 1));
		}
	}
}

// saveURL()はディレクトリを指定する機能がないため使えない
function download(url, dir, progress, cont) {
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
	var download = downloadManager.addDownload(0, uri, fileuri, null, null, null, null, null, persist);
	persist.progressListener = {
		onProgressChange: onProgressChange,
		onStateChange: onStateChange
	};
	persist.saveURI(uri, null, null, null, null, file);

	function onProgressChange(aWebProgress, aRequest, aCurSelfProgress, aMaxSelfProgress, aCurTotalProgress, aMaxTotalProgress) {
		download.onProgressChange.apply(this, arguments);
		if (progress) progress(aCurTotalProgress, aMaxTotalProgress);
	}
	function onStateChange(aWebProgress, aRequest, aStateFlags, aStatus) {
		download.onStateChange.apply(this, arguments);
		if (aStateFlags & Ci.nsIWebProgressListener.STATE_STOP) {
			if (cont) cont(aStatus === 0);
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
