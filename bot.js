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
      console.error('❌ Missing GITHUB_TOKEN');
      process.exit(1);
    }

    const octokit = github.getOctokit(token);
    
    // ========== AUTHENTICATION CHECK ==========
    let authenticatedUser;
    try {
      const { data: user } = await octokit.rest.users.getAuthenticated();
      authenticatedUser = user;
      console.log(`🔑 Authenticated as ${authenticatedUser.login}`);
    } catch (authError) {
      console.error('❌ Authentication failed:', authError);
      process.exit(1);
    }
    
    // ========== TOKEN SCOPE VERIFICATION ==========
    try {
      const { headers } = await octokit.request('HEAD /');
      const scopes = headers['x-oauth-scopes']?.split(', ') || [];
      console.log(`🔐 Token scopes: ${scopes.join(', ')}`);
      
      if (!scopes.includes('repo')) {
        console.error('❌ Token missing required "repo" scope');
        process.exit(1);
      }
    } catch (scopeError) {
      console.error('❌ Scope verification failed:', scopeError);
      process.exit(1);
    }

    const context = github.context;
    console.log(`ℹ️ Event type: ${context.eventName}`);

    console.log('🔍 Finding latest open PR in target repository...');
    
    // Get open PRs in target repository
    const { data: prs } = await octokit.rest.pulls.list({
      owner: TARGET_REPO_OWNER,
      repo: TARGET_REPO_NAME,
      state: 'open'
    });

    if (prs.length === 0) {
      console.error('❌ No open PRs found in target repository');
      process.exit(0);  // Not a failure condition
    }

    // Use the first PR (most recent)
    const targetPr = prs[0];
    const prNumber = targetPr.number;
    const headSha = targetPr.head.sha;
    const prAuthor = targetPr.user.login;
    
    console.log(`🎯 Selected PR #${prNumber} (SHA: ${headSha})`);
    console.log(`👤 PR Author: ${prAuthor}`);
    console.log(`🔗 PR Title: ${targetPr.title}`);

    // Load rules
    let rules;
    try {
      rules = yaml.load(fs.readFileSync('rules.yaml', 'utf8'));
      console.log(`📋 Loaded ${rules.length} rules from rules.yaml`);
    } catch (error) {
      console.error(`❌ Error loading rules: ${error}`);
      process.exit(1);
    }

    // Get PR diff from target repository
    console.log('📥 Fetching PR diff...');
    let diffData;
    try {
      const response = await octokit.rest.repos.compareCommits({
        owner: TARGET_REPO_OWNER,
        repo: TARGET_REPO_NAME,
        base: targetPr.base.sha,
        head: headSha,
        mediaType: { format: 'diff' }
      });
      diffData = response.data;
      console.log(`📄 Fetched PR diff (${diffData.length} bytes)`);
    } catch (error) {
      console.error(`❌ Error fetching diff: ${error}`);
      process.exit(1);
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
        // Determine review event type
        let event = 'COMMENT';
        if (hasCritical && prAuthor !== authenticatedUser.login) {
          event = 'REQUEST_CHANGES';
        }
        
        await octokit.rest.pulls.createReview({
          owner: TARGET_REPO_OWNER,
          repo: TARGET_REPO_NAME,
          pull_number: prNumber,
          commit_id: headSha,
          event: event,
          comments
        });
        console.log(`💬 Posted review with ${comments.length} comments (event: ${event})`);
      } catch (error) {
        console.error(`❌ Error creating review: ${error.message}`);
      }
    } else {
      console.log('✅ No violations found');
    }

    // Set commit status (replaces checks API)
    try {
      const state = hasCritical ? 'failure' : totalViolations > 0 ? 'pending' : 'success';
      const description = hasCritical 
        ? 'Critical violations block merging' 
        : totalViolations > 0 
          ? 'Violations found but not critical' 
          : 'Code meets quality standards';
      
      await octokit.rest.repos.createCommitStatus({
        owner: TARGET_REPO_OWNER,
        repo: TARGET_REPO_NAME,
        sha: headSha,
        state: state,
        context: 'AutoReviewBot',
        description: description
      });
      console.log(`✅ Created commit status: ${state}`);
    } catch (error) {
      console.error(`❌ Error creating commit status: ${error.message}`);
    }

    console.log('🏁 AutoReviewBot completed successfully');
  } catch (error) {
    console.error(`🔥 Bot failed: ${error.stack}`);
    process.exit(1);
  }
}

run();
