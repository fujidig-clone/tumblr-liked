function Set(array) {
	this.hash = {};
	array.forEach(function (val) {
		this.hash[val] = true;
	});
}

Set.prototype.has = function (val) {
	return val in this.hash;
};

function replaceElemText(node, text) {
	var doc = node.ownerDocument;
	node.innerHTML = "";
	node.appendChild(doc.createTextNode(text));
}

function replaceElemChild(node, child) {
	node.innerHTML = "";
	node.appendChild(child);
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
		browser.removeEventListener("load", callback);
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
