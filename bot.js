const { Probot } = require("probot");
const { execSync } = require("child_process");
const fs = require("fs");

module.exports = (app) => {
  app.on("pull_request.opened", async (context) => {
    const { payload, octokit } = context;
    const owner = payload.repository.owner.login;
    const repo = payload.repository.name;
    const pull_number = payload.pull_request.number;
    
    try {
      // Get changed Java files
      const files = await octokit.pulls.listFiles({
        owner,
        repo,
        pull_number,
      });
      
      const javaFiles = files.data
        .filter(file => file.filename.endsWith(".java"))
        .map(file => file.filename);
      
      if (javaFiles.length === 0) {
        await octokit.issues.createComment({
          owner,
          repo,
          issue_number: pull_number,
          body: "✅ No Java files found to review!"
        });
        return;
      }
      
      // Run static analysis
      const comments = [];
      for (const file of javaFiles) {
        try {
          // Check for common issues
          const fileContent = fs.readFileSync(file, "utf8");
          
          // Check for "return null;"
          if (fileContent.includes("return null;")) {
            const lines = fileContent.split("\n");
            lines.forEach((line, index) => {
              if (line.includes("return null;")) {
                comments.push({
                  path: file,
                  line: index + 1,
                  body: "⚠️ **AvoidReturnNull**: Return Optional.empty() instead of null\n" +
                        "Fix: `return Optional.empty();`"
                });
              }
            });
          }
          
          // Check for direct assignment
          const assignmentMatches = fileContent.match(/this\.\w+ = \w+;/g);
          if (assignmentMatches) {
            assignmentMatches.forEach(match => {
              comments.push({
                path: file,
                body: "⚠️ **DefensiveCopy**: Use defensive copying for mutable collections\n" +
                      `Found: \`${match}\`\n` +
                      "Fix: `this.items = new ArrayList<>(items);`"
              });
            });
          }
          
        } catch (err) {
          console.error(`Error processing ${file}:`, err);
        }
      }
      
      // Post comments
      if (comments.length > 0) {
        await octokit.pulls.createReview({
          owner,
          repo,
          pull_number,
          event: "COMMENT",
          comments
        });
      } else {
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
};