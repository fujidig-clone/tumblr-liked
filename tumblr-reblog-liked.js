var libly = liberator.plugins.libly;

var ORIGIN = "http://www.tumblr.com";

// documentに含まれる自分のリブログポストの元ポストが出現するまでのポストを集める
// 自分のtumblelogのdocumentを指定して、
// 既にリブログ済みのポストに到達するまでーということをやるために
function readLikedPostsWithTumblelogDocument(doc, cont) {
	var posts = doc.querySelectorAll("#posts .post.is_reblog.is_mine");
	var urls = Array.map(posts, function(post)
		post.querySelector(".post_info a").getAttribute("href"));
	var urlsRegexp = new RegExp("^(?:" + Array.map(urls, function(url)
					url.replace(/\W/g,'\\$&')).join("|") + ")");
	readLikedPostsWithPredicate(function (allPosts, posts) {
		for (var i = 0; i < posts.length; i ++) {
			if (urlsRegexp.test(getPermalinkURL(posts[i]))) {
				break;
			}
		}
		if (i < posts.length) {
			var numExtra = posts.length - i;
			allPosts.length -= numExtra;
			return true;
		}
		return false;
	}, cont);
}

function readLikedPosts(num, cont) {
	function predicate(allPosts, posts) {
		if (allPosts.length >= num) {
			allPosts.length = num;
			return true;
		}
		return false;
	}
	readLikedPostsWithPredicate(predicate, cont);
}

function readLikedPostsWithPredicate(predicate, cont) {
	var allPosts = [];
	loop(1);
	function loop(page) {
		accessPage(ORIGIN + "/likes/page/" + page, {}, function(res) {
			var doc = convertToHTMLDocument(res.responseText);
			var posts = doc.querySelectorAll("#posts .post");
			allPosts.push.apply(allPosts, posts);
			if (predicate(allPosts, posts)) {
				cont(allPosts);
			} else if (!doc.querySelector("#next_page_link")) {
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
	} else if (postElem.querySelector("photoset_row")) {
		Array.forEach(postElem.querySelectorAll("photoset_row a"), function(a) {
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

// downloadURL()はディレクトリを指定する機能がないため使えない
function download(url, dir) {
	var uri = makeURI(url);
	var fileName = getDefaultFileName(null, uri);
	var downloadManager = Cc["@mozilla.org/download-manager;1"].getService(Ci.nsIDownloadManager);
	var persist = makeWebBrowserPersist();
	var file = services.create("file");
	file.initWithPath(dir);
	file.appendRelativePath(fileName);
	// 同名ファイルがあるときファイル名をかえる
	//  (ちなみにpersistFlagsからPERSIST_FLAGS_REPLACE_EXISTING_FILESを
	//   取り除いてみても変化なく、上書きされた)
	file = uniqueFile(file);
	var fileuri = makeFileURI(file);
	var download = downloadManager.addDownload(0, uri, fileuri, null, null, null, null, null, persist);
	persist.progressListener = download;
	persist.saveURI(uri, null, null, null, null, file);
}

// libly.Response#getHTMLDocumentを使うと相対リンクで問題が起こるため
// TombooのconvertToHTMLDocumentで代用
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
