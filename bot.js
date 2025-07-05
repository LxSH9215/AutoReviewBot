const { App } = require("@octokit/app");
const { Octokit } = require("@octokit/rest");
const fs = require("fs");
const yaml = require("js-yaml");

// Load rules from YAML
const rules = yaml.load(fs.readFileSync("rules.yaml", "utf8"));

// Initialize GitHub App
const app = new App({
  appId: process.env.APP_ID,
  privateKey: process.env.PRIVATE_KEY.replace(/\\n/g, '\n'),
  webhooks: { secret: process.env.WEBHOOK_SECRET },
});

// Handle PR events
app.webhooks.on(["pull_request.opened", "pull_request.synchronize", "pull_request.reopened"], async ({ octokit, payload }) => {
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
      output: {
        title: "Starting code analysis",
        summary: "Scanning changed Java files..."
      }
    });
    
    // Get PR diff
    const diffResponse = await octokit.pulls.get({
      owner,
      repo,
      pull_number,
      mediaType: { format: "diff" }
    });
    
    const changedFiles = diffResponse.data.split(/diff --git/).slice(1);
    const comments = [];
    
    // Analyze each Java file
    for (const fileDiff of changedFiles) {
      const fileNameMatch = fileDiff.match(/a\/.*? b\/(.+?)\n/);
      if (!fileNameMatch) continue;
      
      const fileName = fileNameMatch[1];
      if (!fileName.endsWith(".java")) continue;
      
      const fileContent = fileDiff.split(/@@[^@@]*@@/s).pop();
      
      // Apply all rules
      for (const rule of rules) {
        const regex = new RegExp(rule.pattern, "gm");
        let match;
        
        while ((match = regex.exec(fileContent)) !== null) {
          const lineNumber = fileContent.substr(0, match.index).split('\n').length;
          comments.push({
            path: fileName,
            line: lineNumber,
            body: `**${rule.id}**: ${rule.message}\n\nFix: \`${rule.fix}\``
          });
        }
      }
    }
    
    // Create review
    if (comments.length > 0) {
      await octokit.pulls.createReview({
        owner,
        repo,
        pull_number,
        event: "COMMENT",
        comments
      });
      
      // Update check run to failure
      await octokit.checks.update({
        owner,
        repo,
        check_run_id: checkRun.data.id,
        conclusion: "failure",
        output: {
          title: "Violations found",
          summary: `${comments.length} code quality violations detected`,
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
      // Update check run to success
      await octokit.checks.update({
        owner,
        repo,
        check_run_id: checkRun.data.id,
        conclusion: "success",
        output: {
          title: "No violations",
          summary: "All code meets quality standards"
        }
      });
      
      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: pull_number,
        body: "✅ Great job! No violations found."
      });
    }
    
  } catch (error) {
    console.error("Bot error:", error);
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: pull_number,
      body: "❌ Bot encountered an error: " + error.message
    });
  }
});

// Start server
const port = process.env.PORT || 3000;
app.start(port).then(() => {
  console.log(`AutoReviewBot running on port ${port}`);
});
