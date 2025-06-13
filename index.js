const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const os = require('os');
const fs = require('fs');
const xml2js = require('xml2js');
const { exec } = require('child_process');

// Helper: sanitize file/folder names
function sanitizeFileName(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim();
}

const homeDir = os.homedir();
const dbPath = path.join(
  homeDir,
  'Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Documents/MTLibrary.sqlite'
);

const ttmlRootPath = path.join(
  homeDir,
  'Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Library/Cache/Assets/TTML'
);

// Open the database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Could not open database:', err.message);
    return;
  }
  console.log('Connected to the podcast database.');
});

const query = `
SELECT 
  ZMTEPISODE.ZITUNESTITLE AS episodeTitle, 
  ZMTEPISODE.ZENTITLEDTRANSCRIPTIDENTIFIER AS transcriptPath, 
  ZMTPODCAST.ZTITLE AS podcastTitle
FROM ZMTEPISODE 
JOIN ZMTPODCAST ON ZMTEPISODE.ZPODCASTUUID = ZMTPODCAST.ZUUID
`;

db.all(query, [], (err, rows) => {
  if (err) {
    console.error('Error querying ZMTEPISODE:', err.message);
    return;
  }

  rows.forEach((row) => {
    const podcastTitle = sanitizeFileName(row.podcastTitle || 'UnknownPodcast');
    const episodeTitle = sanitizeFileName(row.episodeTitle || 'UnknownEpisode');
    const transcriptRelativePath = row.transcriptPath;

    if (!transcriptRelativePath) {
      console.warn(`No transcript path for: ${episodeTitle}`);
      return;
    }

    // Extract transcript ID from the filename
    const match = transcriptRelativePath.match(/transcript_(\d+)\.ttml$/);
    if (!match) {
      console.warn(`Malformed transcript path: ${transcriptRelativePath}`);
      return;
    }

    const transcriptID = match[1];
    const actualFilename = `transcript_${transcriptID}.ttml-${transcriptID}.ttml`;

    // Build full path to transcript file
    const transcriptDir = path.dirname(transcriptRelativePath);
    const fullTranscriptPath = path.join(ttmlRootPath, transcriptDir, actualFilename);

    // Output location
    const outputDir = path.join(homeDir, 'ExtractedTranscripts', podcastTitle);
    const outputFile = path.join(outputDir, `${episodeTitle}.ttml`);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    if (fs.existsSync(fullTranscriptPath)) {
      try {
        const ttmlContent = fs.readFileSync(fullTranscriptPath, 'utf8');
        ttmlToVtt(ttmlContent)
          .then((vttContent) => {
            const vttOutputFile = outputFile.replace(/\.ttml$/, '.vtt');
            fs.writeFileSync(vttOutputFile, vttContent, 'utf8');
            console.log(`✅ Saved: ${vttOutputFile}`);
          })
          .catch((err) => {
            console.error(`❌ Failed to convert TTML to VTT for ${episodeTitle}: ${err.message}`);
          });
        console.log(`✅ Saved: ${outputFile}`);
      } catch (copyErr) {
        console.error(`❌ Failed to copy: ${episodeTitle} -> ${copyErr.message}`);
      }
    } else {
      console.warn(`⚠️ Transcript file not found: ${fullTranscriptPath}`);
    }
  });
});

db.close((err) => {
  if (err) {
    console.error('Error closing database:', err.message);
  } else {
    console.log('Database connection closed.');
    // Open the output directory in the system file explorer (works with pkg)
    const outputRoot = path.join(homeDir, 'ExtractedTranscripts');
    let openCmd;
    if (process.platform === 'darwin') {
      openCmd = `open "${outputRoot}"`;
    } else if (process.platform === 'win32') {
      openCmd = `start "" "${outputRoot}"`;
    } else {
      openCmd = `xdg-open "${outputRoot}"`;
    }
    exec(openCmd, (err) => {
      if (err) {
        console.error('Could not open output directory:', err.message);
      }
    });
  }
});





function ttmlToVtt(ttmlString) {
  const parser = new xml2js.Parser();

  return new Promise((resolve, reject) => {
    parser.parseString(ttmlString, (err, result) => {
      if (err) return reject(err);

      const vtt = ['WEBVTT\n'];

      const paragraphs = result.tt.body[0].div[0].p;

      let counter = 1;
      for (const p of paragraphs) {
        const begin = formatTime(p.$.begin);
        const end = formatTime(p.$.end);
        const text = extractText(p);

        vtt.push(`${counter}`);
        vtt.push(`${begin} --> ${end}`);
        vtt.push(`${text}\n`);
        counter++;
      }

      resolve(vtt.join('\n'));
    });
  });
}

function formatTime(timeStr) {
  if (!timeStr) return '00:00:00.000';

  const parts = timeStr.split(':').map(Number);
  let seconds = 0;

  if (parts.length === 3) {
    seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    seconds = parts[0] * 60 + parts[1];
  } else {
    seconds = parseFloat(timeStr);
  }

  const hrs = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const mins = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const secs = (seconds % 60).toFixed(3).padStart(6, '0');

  return `${hrs}:${mins}:${secs}`;
}

function extractText(pElement) {
  let output = '';

  const spanArray = pElement.span || [];
  for (const sentence of spanArray) {
    const wordArray = sentence.span || [];
    for (const word of wordArray) {
      output += word._ + ' ';
    }
  }

  return output.trim();
}