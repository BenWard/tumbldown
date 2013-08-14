!function () {
  var Mustache = require('mustache');
  var fs = require('fs');
  var req = require('request');
  var url = require('url');
  var templates = {};

  // Date Formatting
  function pad (n) {
    return n < 10 ? "0" + n : n;
  }

  function iso8601 (timestamp) {
    var d = new Date(timestamp * 1000);
    if (!d) throw new Error("Couldn't parse date " + timestamp);
    return [d.getUTCFullYear(), "-",
      pad(d.getUTCMonth() + 1), "-",
      pad(d.getUTCDate()), "T",
      pad(d.getUTCHours()), ":",
      pad(d.getUTCMinutes()), ":",
      pad(d.getUTCSeconds()), "+0000"].join("");
  }

  function postYear (timestamp) {
    var d = new Date(timestamp * 1000);
    if (!d) throw new Error("Couldn't parse date " + timestamp);
    return d.getUTCFullYear();
  }

  function datestamp (timestamp) {
    var d = new Date(timestamp * 1000);
    if (!d) throw new Error("Couldn't parse date " + timestamp);
    return [ d.getUTCFullYear(), "-",
      pad(d.getUTCMonth() + 1), "-",
      pad(d.getUTCDate())].join("");
  }

  // Portable URL generation.
  function generateSlug (post) {
    return (/(?:pownce-)?(\d{7,})/.test(post.slug)) ? "pownce-" + RegExp.$1 : 'tumblr-' + post.id;
  }

  function extractEntryTitle (post, strip) {
    // Take post.source before post.text for Quote types
    var text = post.source || post.body || post.text || post.caption || post.description;
    var lines = text && text.split("\n") || [];
    var blockCount = 0; // How far into the entry are we?
    var i = 0;
    var line;

    strip = (strip !== undefined) ? strip : true;

    if (post.title) return {
      title: post.title,
      text: text
    };

    for (i = 0; (line = lines[i]); i++) {

      // Ignore empty lines
      if (!line.length) continue;

      // Match a heading in Markdown or HTML
      if (/^\s*(#+|<h[1-6]>).*$/i.test(line)) {

        // Now we need to see if the title embeds any links. If it does,
        // we want to strip out the link mark-up...

        // Crudely check for nested links in HTML or Markdown:
        if (strip && !/(<a |\]\(http)/i.test(line)) {
          // If there has been no other content so far (allowing one block
          // for quote attribution), and we're stripping titles out of the
          // text to avoid duplication, do it:
          //
          // If there was a link nested in the title, we leave it be.
          lines.splice(i, 2);
          text = lines.join("\n");
        }

        // In the final return, strip not-inline HTML tags.
        return {
          title: stripMarkup(line.replace("\n", "")),
          text: text
        };
      }

      if (++blockCount > 2) break; // Too far into the post. Give up.
    }
    return {
      title: '',
      text: text
    };
  }

  function stripMarkup (text) {
    return text
      .replace(/<a[^>]+>([^<]+)<\/a>/g, "$1") // HTML links
      .replace(/<h1>([^<]+)<\/h1>/, "$1") // HTML headlines
      .replace(/^#+(.+)$/, "$1") // Markdown headlines
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1") // Markdown links
      .replace(/\\\*/g, "*") // Weird escaping error in one title
      .replace(/(^\s+|\s+$)/g, ""); // Leading whitespace
  }

  // Pre-render view augmentation
  function loadTemplates () {
    fs.readdir('templates', function (err, files) {
      if (err) return console.log("Error reading templates");
      files.forEach(function (f) {
        var data;
        if (/([\w_]+)\.part.mustache$/.test(f)) {
          return Mustache.compilePartial(RegExp.$1, fs.readFileSync('templates/' + f, 'utf8'));
        }
        if (/([\w_]+)\.mustache$/.test(f)) {
          return templates[RegExp.$1] = Mustache.compile(fs.readFileSync('templates/' + f, 'utf8'));
        }
      });
    });
  }

  function view (post) {
    var entry = extractEntryTitle(post);

    post.iso8601 = iso8601(post.timestamp);
    post.title = entry.title;
    post.body = entry.text;

    post.slug = generateSlug(post);
    if (/^pownce-(\d+)/.test(post.slug)) {
      post.pownce = true;
      post.service = 'pownce';
      post.post_url = 'http://pownce.com/benward/notes/' + RegExp.$1;
    }
    else {
      post.service = 'tumblr';
    }

    // Reclaim special replyto: and geo: machine tags
    post.tags = post.tags.filter(function (item) {
      if (/^replyto:(.+)$/.test(item)) {
        post.in_reply_to_url = RegExp.$1;

        if (post.service == 'pownce' &&
            /^http:\/\/pownce/.test(post.in_reply_to_url)) {
          // So, reply comments on Pownce never had standalone permalinks apart
          // from a fragment ID, which I didn't save. But the original post is
          // the real page for the content. So, pretty close enough:
          post.post_url = post.in_reply_to_url;
        }
        return false;
      }
      if (/^geo:(.+)$/.test(item)) {
        post.geo = RegExp.$1;
        return false;
      }
      return true;
    });

    post.has_tags = !!post.tags.length;

    if (post.type == 'quote') {
      post.text = post.text.split("\n").map(function (line) {
        return "> " + line;
      }).join("\n");
    }

    if (post.type == 'photo') {
      post.photos.forEach(function (photo, number) {
        var urlWithExtension = photo.alt_sizes[0].url;
        var urlParts = urlWithExtension.split('/').pop().split('.');
        var extesion = urlParts.length > 1 ? urlParts.pop() : 'jpg';

        photo.original_size.url = fetchMedia(
          photo.original_size.url,
          extesion,
          post.id,
          'http://benward.me/res/tumblr',
          number
        );
      });
    }

    if (post.type ==  'video') {
      // Select the largest video player
      post.video = post.player.pop();
    }

    return post;
  }

  function render (post) {
    if (!templates[post.type]) return console.log("Error: No template for " + post.type);
    return templates[post.type](view(post));
  }

  function loadPostJSON () {
    fs.readdir('posts', function (err, files) {
      files.forEach(function (file) {
        if (!/\.json$/.test(file)) return;
        var data = fs.readFileSync('posts/' + file, 'utf8');
        writeJekyllPost(JSON.parse(data));
      });
    });
  }

  // Extract Tumblr images and audio from pages
  function extractTumblrMedia (body) {
    var media = [];
    while (/src="(http:\/\/www\.tumblr\.com[^"]+)"/.test(body)) {
      media.push(RegExp.$1);
    }
    return media;
  }

  // Given a Tumblr media URL, generate the new URL for it, and set of a req
  // call to fetch the image in a background call
  function fetchMedia (mediaUrl, extension, postId, baseUrl, mediaId) {
    var outputDir = 'media/' + postId;
    var fileNumber = mediaId || 0;
    var imagePath = outputDir + "/" + fileNumber + "." + extension;

    if (!fs.existsSync('media')) fs.mkdirSync('media');

    // HACK: We've downloaded these images once. Probably good now.
    false && req.get({ url: mediaUrl, encoding: null }, function (err, rsp, image) {
      if (err) return console.log("Crap. Error fetching <" + mediaUrl + ">. " + err);

      // Write Files
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
      fs.writeFileSync(imagePath, image, 'binary');
    });

    return baseUrl + "/" + imagePath;
  }

  function writeJekyllPost (post) {
    var year = postYear(post.timestamp);

    if (!fs.existsSync('jekyll/' + year)) fs.mkdirSync('jekyll/' + year);

    var renderedPost = render(post);
    var filename = 'jekyll/' + year + '/' + post.slug + '.md';

    fs.writeFileSync(filename, renderedPost);
    //console.log("Wrote " + filename);
  }

  function main () {
    if (!fs.existsSync('jekyll')) fs.mkdirSync('jekyll');
    loadTemplates();
    loadPostJSON();
  }

  function logError (message) {
    // Write errors here, like if we fail to download an image file that needs
    // to be found by hand later.
  }

  main();

}();