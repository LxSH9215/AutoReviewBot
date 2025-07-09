const core = require('@actions/core');
const github = require('@actions/github');
const yaml = require('js-yaml');
const fs = require('fs');
const { parseDiff } = require('parse-diff');

async function run() {
  try {
    core.info('🚀 AutoReviewBot starting...');
    const token = core.getInput('GITHUB_TOKEN');
    if (!token) {
      core.setFailed('❌ Missing GITHUB_TOKEN');
      return;
    }

    const octokit = github.getOctokit(token);
    const context = github.context;
    
    // Validate event type
    if (context.eventName !== 'pull_request') {
      core.setFailed(`❌ Invalid event: ${context.eventName}. Only PR events supported`);
      return;
    }

    const pr = context.payload.pull_request;
    if (!pr) {
      core.setFailed('❌ Missing pull request data');
      return;
    }

    const prNumber = pr.number;
    const headSha = pr.head.sha;
    core.info(`📦 Processing PR #${prNumber} (SHA: ${headSha})`);

    // Check for merge conflicts
    if (pr.mergeable === false) {
      core.info('⚠️ PR has merge conflicts - skipping analysis');
      await octokit.rest.checks.create({
        owner: context.repo.owner,
        repo: context.repo.repo,
        name: 'AutoReviewBot',
        head_sha: headSha,
        conclusion: 'neutral',
        output: {
          title: 'Skipped due to merge conflicts',
          summary: 'Resolve conflicts to enable analysis'
        }
      });
      return;
    }

    // Load rules
    let rules;
    try {
      rules = yaml.load(fs.readFileSync('rules.yaml', 'utf8'));
      core.info(`📋 Loaded ${rules.length} rules from rules.yaml`);
    } catch (error) {
      core.setFailed(`❌ Error loading rules: ${error}`);
      return;
    }

    // Get PR diff
    let diffData;
    try {
      ({ data: diffData } = await octokit.rest.pulls.get({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: prNumber,
        mediaType: { format: 'diff' }
      }));
      core.info(`📄 Fetched PR diff (${diffData.length} bytes)`);
    } catch (error) {
      core.setFailed(`❌ Error fetching diff: ${error}`);
      return;
    }

    // Parse diff
    const diffFiles = parseDiff(diffData);
    core.info(`🔍 Found ${diffFiles.length} changed files`);
    
    const comments = [];
    let hasCritical = false;
    let totalViolations = 0;

    // Analyze each file
    diffFiles.forEach(file => {
      if (!file.to || !file.to.endsWith('.java')) {
        core.info(`⏩ Skipping non-Java file: ${file.to || 'unknown'}`);
        return;
      }

      core.info(`🔎 Analyzing ${file.to}`);
      const fileLines = file.chunks.flatMap(chunk => 
        chunk.changes.filter(c => c.type !== 'del').map(c => c.content)
      );
      
      const fileContent = fileLines.join('\n');
      let fileViolations = 0;

      // Check each rule
      rules.forEach(rule => {
        try {
          const regex = new RegExp(rule.pattern, rule.flags || 'gm');
          let match;
          
          while ((match = regex.exec(fileContent)) !== null) {
            // Calculate line number
            const contentBeforeMatch = fileContent.substring(0, match.index);
            const line = contentBeforeMatch.split('\n').length;
            
            comments.push({
              path: file.to,
              line,
              body: `### ⚠️ ${rule.id}\n${rule.message}${rule.fix ? `\n\n**Fix Suggestion:**\n\`\`\`java\n${rule.fix}\n\`\`\`` : ''}`
            });
            
            fileViolations++;
            totalViolations++;
            if (rule.critical) hasCritical = true;
          }
        } catch (error) {
          core.error(`❌ Error processing rule ${rule.id}: ${error}`);
        }
      });
      
      if (fileViolations > 0) {
        core.info(`❗ Found ${fileViolations} violations in ${file.to}`);
      }
    });

    core.info(`📊 Total violations found: ${totalViolations}`);
    core.info(`🚨 Critical issues: ${hasCritical ? 'YES' : 'NO'}`);

    // Create review if violations found
    if (comments.length > 0) {
      try {
        await octokit.rest.pulls.createReview({
          owner: context.repo.owner,
          repo: context.repo.repo,
          pull_number: prNumber,
          commit_id: headSha,
          event: hasCritical ? 'REQUEST_CHANGES' : 'COMMENT',
          comments
        });
        core.info(`💬 Posted review with ${comments.length} comments`);
      } catch (error) {
        core.error(`❌ Error creating review: ${error}`);
      }
    } else {
      core.info('✅ No violations found');
    }

    // Set check status
    try {
      await octokit.rest.checks.create({
        owner: context.repo.owner,
        repo: context.repo.repo,
        name: 'AutoReviewBot',
        head_sha: headSha,
        status: 'completed',
        conclusion: hasCritical ? 'failure' : totalViolations > 0 ? 'neutral' : 'success',
        output: {
          title: totalViolations > 0 
            ? `Found ${totalViolations} violation${totalViolations > 1 ? 's' : ''}`
            : 'No violations found',
          summary: hasCritical 
            ? 'Critical violations block merging'
            : totalViolations > 0
              ? 'Violations found but not critical'
              : 'Code meets quality standards'
        }
      });
      core.info(`✅ Created check with status: ${hasCritical ? 'failure' : 'success'}`);
    } catch (error) {
      core.setFailed(`❌ Error creating check: ${error}`);
    }

  } catch (error) {
    core.setFailed(`🔥 Bot failed: ${error}`);
    console.error(error.stack);
  }
}

run();
