const core = require('@actions/core');
const github = require('@actions/github');
const yaml = require('js-yaml');
const fs = require('fs');
const parseDiff = require('parse-diff');

// Configuration for target repository
const TARGET_REPO_OWNER = "LxSH9215";
const TARGET_REPO_NAME = "AutoReviewBot-Test";

async function run() {
  try {
    console.log('🚀 AutoReviewBot starting...');
    console.log(`🔧 Targeting repository: ${TARGET_REPO_OWNER}/${TARGET_REPO_NAME}`);
    
    // Get token from environment
    const token = process.env.GITHUB_TOKEN;
    console.log(`🔑 Token present: ${token ? 'Yes' : 'No'}`);
    
    if (!token) {
      core.setFailed('❌ Missing GITHUB_TOKEN');
      return;
    }

    const octokit = github.getOctokit(token);
    const context = github.context;

    // Validate event type
    console.log(`ℹ️ Event type: ${context.eventName}`);

    console.log('🔍 Finding latest open PR in target repository...');
    
    // Get open PRs in target repository
    const { data: prs } = await octokit.rest.pulls.list({
      owner: TARGET_REPO_OWNER,
      repo: TARGET_REPO_NAME,
      state: 'open'
    });

    if (prs.length === 0) {
      core.setFailed('❌ No open PRs found in target repository');
      return;
    }

    // Use the first PR (most recent)
    const targetPr = prs[0];
    const prNumber = targetPr.number;
    const headSha = targetPr.head.sha;
    
    console.log(`🎯 Selected PR #${prNumber} (SHA: ${headSha})`);
    console.log(`🔗 PR Title: ${targetPr.title}`);

    // Load rules
    let rules;
    try {
      rules = yaml.load(fs.readFileSync('rules.yaml', 'utf8'));
      console.log(`📋 Loaded ${rules.length} rules from rules.yaml`);
    } catch (error) {
      core.setFailed(`❌ Error loading rules: ${error}`);
      return;
    }

    // Get PR diff from target repository
    console.log('📥 Fetching PR diff...');
    let diffData;
    try {
      ({ data: diffData } = await octokit.rest.repos.compareCommits({
        owner: TARGET_REPO_OWNER,
        repo: TARGET_REPO_NAME,
        base: targetPr.base.sha,
        head: headSha,
        mediaType: { format: 'diff' }
      }));
      console.log(`📄 Fetched PR diff (${diffData.length} bytes)`);
    } catch (error) {
      core.setFailed(`❌ Error fetching diff: ${error}`);
      return;
    }

    // Parse diff
    const diffFiles = parseDiff(diffData);
    console.log(`🔍 Found ${diffFiles.length} changed files`);
    
    const comments = [];
    let hasCritical = false;
    let totalViolations = 0;

    // Analyze each file
    diffFiles.forEach(file => {
      if (!file.to || !file.to.endsWith('.java')) {
        console.log(`⏩ Skipping non-Java file: ${file.to || 'unknown'}`);
        return;
      }

      console.log(`🔎 Analyzing ${file.to}`);
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
          console.error(`❌ Error processing rule ${rule.id}: ${error}`);
        }
      });
      
      if (fileViolations > 0) {
        console.log(`❗ Found ${fileViolations} violations in ${file.to}`);
      }
    });

    console.log(`📊 Total violations found: ${totalViolations}`);
    console.log(`🚨 Critical issues: ${hasCritical ? 'YES' : 'NO'}`);

    // Create review in target repository
    if (comments.length > 0) {
      try {
        await octokit.rest.pulls.createReview({
          owner: TARGET_REPO_OWNER,
          repo: TARGET_REPO_NAME,
          pull_number: prNumber,
          commit_id: headSha,
          event: hasCritical ? 'REQUEST_CHANGES' : 'COMMENT',
          comments
        });
        console.log(`💬 Posted review with ${comments.length} comments to target repository`);
      } catch (error) {
        console.error(`❌ Error creating review: ${error}`);
      }
    } else {
      console.log('✅ No violations found');
    }

    // Set check status in target repository
    try {
      await octokit.rest.checks.create({
        owner: TARGET_REPO_OWNER,
        repo: TARGET_REPO_NAME,
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
      console.log(`✅ Created check with status: ${hasCritical ? 'failure' : 'success'}`);
    } catch (error) {
      core.setFailed(`❌ Error creating check: ${error}`);
    }

  } catch (error) {
    core.setFailed(`🔥 Bot failed: ${error}`);
    console.error(error.stack);
  }
}

run();
