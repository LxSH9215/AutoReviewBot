const { App } = require("@octokit/app");
const { Octokit } = require("@octokit/rest");
const fs = require("fs");
const yaml = require("js-yaml");

// Load rules
const rules = yaml.load(fs.readFileSync("rules.yaml", "utf8"));

// Initialize GitHub App
const app = new App({
  appId: process.env.APP_ID,
  privateKey: process.env.PRIVATE_KEY.replace(/\\n/g, '\n'),
  webhooks: { secret: process.env.WEBHOOK_SECRET }
});

// Handle PR events
app.webhooks.on(["pull_request.opened", "pull_request.synchronize"], async ({ octokit, payload }) => {
  const { repository, pull_request } = payload;
  const owner = repository.owner.login;
  const repo = repository.name;
  const pull_number = pull_request.number;
  
  try {
    // Create check run
    const checkRun = await octokit.checks.create({
      owner,
      repo,
      name: "AutoReviewBot",
      head_sha: pull_request.head.sha,
      status: "in_progress",
      output: { title: "Starting analysis", summary: "Scanning Java files..." }
    });
    
    // Get PR diff
    const diff = await octokit.pulls.get({
      owner,
      repo,
      pull_number,
      mediaType: { format: "diff" }
    });
    
    const files = diff.data.split('\n');
    const comments = [];
    let currentFile = '';
    
    // Parse diff
    for (const line of files) {
      if (line.startsWith('diff --git')) {
        const match = line.match(/ b\/(.*\.java)/);
        if (match) currentFile = match[1];
      }
      
      if (currentFile && line.startsWith('+')) {
        const code = line.substring(1);
        
        // Check against all rules
        for (const rule of rules) {
          if (new RegExp(rule.pattern).test(code)) {
            const lineNumber = line.match(/@@ \-(\d+)/)[1];
            comments.push({
              path: currentFile,
              line: parseInt(lineNumber),
              body: `**${rule.id}**: ${rule.message}\n\nFix: ${rule.fix}`
            });
          }
        }
      }
    }
    
    // Post results
    if (comments.length > 0) {
      await octokit.pulls.createReview({
        owner,
        repo,
        pull_number,
        event: "COMMENT",
        comments
      });
      
      await octokit.checks.update({
        ...checkRun.data,
        conclusion: "failure",
        output: { 
          title: "Violations found", 
          summary: `${comments.length} issues detected`,
          annotations: comments.map(c => ({
            path: c.path,
            start_line: c.line,
            end_line: c.line,
            annotation_level: "failure",
            message: c.body
          }))
        }
      });
    } else {
      await octokit.checks.update({
        ...checkRun.data,
        conclusion: "success",
        output: { title: "No violations", summary: "Code meets quality standards" }
      });
    }
    
  } catch (error) {
    console.error("Bot error:", error);
    await octokit.checks.update({
      ...checkRun.data,
      conclusion: "failure",
      output: { title: "Error", summary: error.message }
    });
  }
});

// Start server
const port = process.env.PORT || 3000;
app.start(port).then(() => console.log(`Bot running on port ${port}`));
