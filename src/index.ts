import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface ConverterConfig {
  excludedDirectories: string[];
  godotDocsPath: string;
  outputFile: string;
  concurrency: number;
  language?: 'gdscript' | 'csharp' | 'both';
  git?: {
    enabled: boolean;
    repository: string;
    branch: string;
    autoUpdate: boolean;
  };
}

class GodotDocsConverter {
  private readonly config: ConverterConfig = {
    excludedDirectories: ['about', 'community', 'contributing', 'tutorials'],
    godotDocsPath: './godot-docs',
    outputFile: './llms.md',
    concurrency: 5,
    language: 'both',
    git: {
      enabled: true,
      repository: 'https://github.com/godotengine/godot-docs.git',
      branch: 'master',
      autoUpdate: true
    }
  };
  private convertedFiles: string[] = [];

  constructor(customConfig?: Partial<ConverterConfig>) {
    if (customConfig) {
      this.config = { ...this.config, ...customConfig };
      // Merge git config properly
      if (customConfig.git) {
        this.config.git = { ...this.config.git, ...customConfig.git };
      }
    }
  }

  /**
   * Main entry point for the conversion process
   */
  async convert(): Promise<void> {
    console.log('🚀 Starting Godot docs conversion...');
    
    // Show compatibility warning
    this.showCompatibilityWarning();
    
    // Handle git repository
    if (this.config.git?.enabled) {
      await this.handleGitRepository();
    }
    
    console.log(`📂 Excluding directories: ${this.config.excludedDirectories.join(', ')}`);
    console.log(`⚡ Using ${this.config.concurrency} concurrent workers`);
    console.log(`🗣️ Language filter: ${this.config.language}`);
    
    // Find all eligible RST files
    const rstFiles = this.findRstFiles();
    console.log(`📁 Found ${rstFiles.length} RST files to convert`);

    // Convert files concurrently
    await this.convertFilesConcurrently(rstFiles);

    // Combine all markdown files into a single file
    console.log('📄 Combining all markdown files...');
    this.combineMarkdownFiles();
    
    console.log(`✅ Conversion complete! Generated ${this.config.outputFile} with ${this.convertedFiles.length} files`);
  }

  /**
   * Show compatibility warning about the parsing logic
   */
  private showCompatibilityWarning(): void {
    console.log('\n⚠️  COMPATIBILITY WARNING:');
    console.log('   This parser is designed for Godot docs master branch as of May 30, 2025.');
    console.log('   Using different branches or older commits may result in parsing issues.');
    console.log('   For best results, use the default master branch.\n');
  }

  /**
   * Handle git repository cloning/updating
   */
  private async handleGitRepository(): Promise<void> {
    const repoPath = this.config.godotDocsPath;
    const gitConfig = this.config.git!;

    try {
      if (fs.existsSync(repoPath)) {
        if (fs.existsSync(path.join(repoPath, '.git'))) {
          console.log(`📦 Godot docs repository found at ${repoPath}`);
          
          if (gitConfig.autoUpdate) {
            console.log(`🔄 Updating repository (branch: ${gitConfig.branch})...`);
            this.executeGitCommand(`git -C "${repoPath}" fetch origin`);
            this.executeGitCommand(`git -C "${repoPath}" checkout ${gitConfig.branch}`);
            this.executeGitCommand(`git -C "${repoPath}" pull origin ${gitConfig.branch}`);
            console.log('✅ Repository updated successfully');
          } else {
            console.log('📌 Using existing repository (auto-update disabled)');
          }
        } else {
          console.log(`⚠️  Directory ${repoPath} exists but is not a git repository`);
          console.log('   Please remove it or change godotDocsPath in your configuration');
          throw new Error('Invalid repository directory');
        }
      } else {
        console.log(`📥 Cloning Godot docs repository...`);
        console.log(`   Repository: ${gitConfig.repository}`);
        console.log(`   Branch: ${gitConfig.branch}`);
        console.log(`   Destination: ${repoPath}`);
        
        this.executeGitCommand(`git clone --branch ${gitConfig.branch} --single-branch "${gitConfig.repository}" "${repoPath}"`);
        console.log('✅ Repository cloned successfully');
      }

      // Show current commit info
      const commitHash = this.executeGitCommand(`git -C "${repoPath}" rev-parse HEAD`).trim();
      const commitDate = this.executeGitCommand(`git -C "${repoPath}" log -1 --format=%cd --date=short`).trim();
      console.log(`📍 Using commit: ${commitHash.substring(0, 8)} (${commitDate})`);
      
    } catch (error) {
      console.error('❌ Git operation failed:', error instanceof Error ? error.message : error);
      console.log('\n💡 Troubleshooting tips:');
      console.log('   • Ensure git is installed and available in PATH');
      console.log('   • Check your internet connection');
      console.log('   • Verify repository URL is accessible');
      console.log('   • Set git.enabled to false in config to skip git operations');
      throw error;
    }
  }

  /**
   * Execute git command with error handling
   */
  private executeGitCommand(command: string): string {
    try {
      return execSync(command, { 
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      throw new Error(`Git command failed: ${command}\n${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Convert files using concurrent processing
   */
  private async convertFilesConcurrently(rstFiles: string[]): Promise<void> {
    const results: (string | null)[] = new Array(rstFiles.length);
    let completed = 0;

    // Process files in batches based on concurrency limit
    for (let i = 0; i < rstFiles.length; i += this.config.concurrency) {
      const batch = rstFiles.slice(i, i + this.config.concurrency);
      const batchPromises = batch.map(async (rstFile, batchIndex) => {
        const globalIndex = i + batchIndex;
        try {
          const markdownContent = await this.convertRstToMarkdownAsync(rstFile);
          if (markdownContent.trim()) {
            results[globalIndex] = markdownContent;
          }
          completed++;
          console.log(`📝 Completed ${completed}/${rstFiles.length}: ${rstFile}`);
          return markdownContent;
        } catch (error) {
          console.warn(`⚠️  Failed to convert ${rstFile}:`, error instanceof Error ? error.message : error);
          completed++;
          return null;
        }
      });

      // Wait for current batch to complete before starting next batch
      await Promise.all(batchPromises);
    }

    // Filter out null results and add to convertedFiles in order
    this.convertedFiles = results.filter((result): result is string => result !== null);
  }

  /**
   * Async version of RST to markdown conversion
   */
  private async convertRstToMarkdownAsync(rstFilePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const markdownContent = this.convertRstToMarkdown(rstFilePath);
        resolve(markdownContent);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Load configuration from file if it exists
   */
  private loadConfigFromFile(configPath: string = './converter.config.json'): Partial<ConverterConfig> | null {
    try {
      if (fs.existsSync(configPath)) {
        const configContent = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(configContent) as Partial<ConverterConfig>;
        console.log(`📋 Loaded configuration from ${configPath}`);
        return config;
      }
    } catch (error) {
      console.warn(`⚠️  Failed to load config from ${configPath}:`, error instanceof Error ? error.message : error);
    }
    return null;
  }

  /**
   * Initialize configuration from file and custom overrides
   */
  private initializeConfig(customConfig?: Partial<ConverterConfig>): void {
    // Load from file first
    const fileConfig = this.loadConfigFromFile();
    
    // Apply configurations in order: defaults -> file -> custom
    if (fileConfig) {
      Object.assign(this.config, fileConfig);
    }
    if (customConfig) {
      Object.assign(this.config, customConfig);
    }
  }

  /**
   * Find all RST files that meet the criteria:
   * - In subdirectories of godot-docs
   * - Don't have . or _ prefix
   * - Are .rst files
   * - Not in excluded directories
   */
  private findRstFiles(): string[] {
    const rstFiles: string[] = [];
    
    const findRstFilesRecursive = (dir: string, isSubdir = false): void => {
      if (!fs.existsSync(dir)) {
        throw new Error(`Directory ${dir} does not exist`);
      }

      const items = fs.readdirSync(dir);
      
      for (const item of items) {
        // Skip items starting with . or _
        if (item.startsWith('.') || item.startsWith('_')) {
          continue;
        }

        // Check if this directory should be excluded
        if (isSubdir) {
          const relativePath = path.relative(this.config.godotDocsPath, dir);
          const topLevelDir = relativePath.split(path.sep)[0];
          if (this.config.excludedDirectories.includes(topLevelDir)) {
            continue;
          }
        }

        const itemPath = path.join(dir, item);
        const stat = fs.statSync(itemPath);

        if (stat.isDirectory()) {
          // Check if we should exclude this top-level directory
          if (!isSubdir && this.config.excludedDirectories.includes(item)) {
            console.log(`🚫 Skipping excluded directory: ${item}`);
            continue;
          }
          // Recursively search subdirectories
          findRstFilesRecursive(itemPath, true);
        } else if (stat.isFile() && item.endsWith('.rst') && isSubdir) {
          // Only include .rst files that are in subdirectories
          rstFiles.push(itemPath);
        }
      }
    };

    findRstFilesRecursive(this.config.godotDocsPath);
    return rstFiles.sort();
  }

  /**
   * Convert a single RST file to markdown using pandoc
   */
  private convertRstToMarkdown(rstFilePath: string): string {
    try {
      // Read the RST file content
      const rstContent = fs.readFileSync(rstFilePath, 'utf8');
      
      // Filter content based on language preference
      const filteredContent = this.filterByLanguage(rstContent);
      
      // Write filtered content to a temporary file for pandoc
      const tempFile = `${rstFilePath}.tmp`;
      fs.writeFileSync(tempFile, filteredContent, 'utf8');
      
      try {
        // Use pandoc to convert RST to GFM format with aggressive cleanup
        const command = `pandoc "${tempFile}" -f rst -t gfm --strip-comments --no-highlight --wrap=none`;
        
        const result = execSync(command, { 
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large files
        });

        // Clean up the content aggressively for LLM consumption
        const cleanedContent = this.cleanupForLLM(result);
        
        // Add file header for context
        const relativePath = path.relative(this.config.godotDocsPath, rstFilePath);
        const header = `\n\n## ${relativePath}\n\n`;
        
        return header + cleanedContent;
      } finally {
        // Clean up temporary file
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      }
    } catch (error) {
      throw new Error(`Pandoc conversion failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Aggressively clean up RST/Sphinx markup for LLM consumption
   */
  private cleanupForLLM(content: string): string {
    // Remove image references first
    content = this.removeImageReferences(content);
    
    // Remove Sphinx/RST specific markup and HTML divs from GFM
    content = content
      // Remove HTML divs and their content (from GFM conversion)
      .replace(/<div[^>]*>[\s\S]*?<\/div>/g, '')
      
      // Remove empty table rows (||) that pandoc creates from failed table conversions
      .replace(/^\|\|.*$/gm, '')
      .replace(/^\s*\|\s*\|\s*$/gm, '')
      
      // Remove HTML-style divs and sections
      .replace(/::::\s*\{[^}]*\}/g, '')
      .replace(/:::\s*rst-class[^:]*$/gm, '')
      .replace(/:::\s*\w+$/gm, '')
      .replace(/::::/g, '')
      .replace(/:::/g, '')
      
      // Remove interpreted text roles like {.interpreted-text role="ref"}
      .replace(/\{\.interpreted-text role="[^"]*"\}/g, '')
      
      // Remove reference links like `🔗<class_name>`
      .replace(/`🔗<[^>]*>`/g, '')
      
      // Remove CSS class annotations
      .replace(/\{#[^}]*\}/g, '')
      .replace(/\{\.classref[^}]*\}/g, '')
      
      // Remove verbose method annotations
      .replace(/`const \(This method has no side effects[^`]*\)`/g, '')
      .replace(/`static \(This method[^`]*\)`/g, '')
      .replace(/`virtual \(This method[^`]*\)`/g, '')
      
      // Clean up Sphinx directives
      .replace(/^\s*\.\.\s+\w+::/gm, '')
      
      // Remove metadata directives at the start
      .replace(/^github_url\s*:\s*hide\s*$/gm, '')
      .replace(/^[a-z_]+\s*:\s*[^\n]*$/gm, '')
      
      // Remove horizontal rules and separators
      .replace(/^-{4,}$/gm, '')
      .replace(/^\s*-{4,}\s*$/gm, '')
      
      // Remove empty directives and blocks
      .replace(/^\s*:\w+:\s*$/gm, '')
      .replace(/^\s*-group\s*$/gm, '')
      
      // Clean up method and class references more carefully
      .replace(/`([A-Z][a-zA-Z0-9_]*)<class_[^>]*>`/g, '$1') // Class references
      .replace(/`([a-z_][a-zA-Z0-9_]*)\(\)<class_[^>]*_method_[^>]*>`/g, '$1()') // Method references
      .replace(/`([a-z_][a-zA-Z0-9_]*)<class_[^>]*_method_[^>]*>`/g, '$1()') // Method references without parentheses
      .replace(/`([a-zA-Z0-9_]+)<[^>]*>`/g, '$1') // Other references
      
      // Fix class titles - preserve the actual class name but clean up the prefix
      .replace(/^(#+)\s*class_([a-zA-Z0-9_]+)$/gm, '$1 $2')
      
      // Remove "classref-" prefixed elements that might remain
      .replace(/classref-[\w-]+/g, '')
      
      // Clean up method signatures - preserve structure but remove markup
      .replace(/\*\*([^*]+)\*\*\([^)]*\)\s*\{[^}]*\}/g, '**$1()**')
      
      // Remove empty lines after headings cleanup
      .replace(/(#{1,6}[^\n]*)\n\s*\n(?=\S)/g, '$1\n\n')
      
      // Clean up multiple consecutive newlines but preserve paragraph breaks
      .replace(/\n{3,}/g, '\n\n')
      
      // Remove excessive whitespace within lines but preserve structure
      .replace(/[ \t]+/g, ' ')
      
      // Remove empty sections
      .replace(/^#+\s*$/gm, '')
      
      // Final trim
      .trim();

    // Post-processing to fix common issues WITHOUT breaking programming identifiers
    content = content
      // Fix mashed words (common after removing markup) but be careful with programming identifiers
      .replace(/(\w)(\*\*\w)/g, '$1 $2') // Add space before bold text
      .replace(/([.!?])([A-Z])/g, '$1 $2') // Ensure space after punctuation
      
      // Fix common method reference patterns
      .replace(/`([a-z_][a-zA-Z0-9_]*)\(\)` /g, '$1() ') // Clean method references
      
      // Remove lines that are just markup artifacts
      .split('\n')
      .filter(line => {
        const trimmed = line.trim();
        return trimmed.length > 0 && 
               !trimmed.match(/^[-:]+$/) && 
               !trimmed.match(/^[{}]+$/) &&
               !trimmed.match(/^\s*group\s*$/) &&
               !trimmed.match(/^\s*separator\s*$/) &&
               !trimmed.match(/^\s*classref-.*$/) &&
               !trimmed.match(/^\s*<.*>\s*$/); // Remove isolated HTML tags
      })
      .join('\n')
      
      // Final cleanup
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Reconstruct Properties and Methods tables from descriptions
    content = this.reconstructTables(content);

    return content;
  }

  /**
   * Reconstruct Properties and Methods tables from the detailed descriptions
   */
  private reconstructTables(content: string): string {
    const lines = content.split('\n');
    const result: string[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      
      // Check for empty Properties section
      if (line.trim() === '## Properties' && i + 1 < lines.length && lines[i + 1].trim() === '## Methods') {
        result.push(line);
        
        // Extract properties from Property Descriptions section
        const propertyTable = this.extractPropertiesTable(lines, i);
        if (propertyTable) {
          result.push('');
          result.push(propertyTable);
          result.push('');
        }
        
        i++;
        continue;
      }
      
      // Check for empty Methods section
      if (line.trim() === '## Methods' && i + 1 < lines.length && lines[i + 1].trim() === '## Property Descriptions') {
        result.push(line);
        
        // Extract methods from Method Descriptions section
        const methodTable = this.extractMethodsTable(lines, i);
        if (methodTable) {
          result.push('');
          result.push(methodTable);
          result.push('');
        }
        
        i++;
        continue;
      }
      
      result.push(line);
      i++;
    }

    return result.join('\n');
  }

  /**
   * Extract properties information and create a table
   */
  private extractPropertiesTable(lines: string[], startIndex: number): string | null {
    const properties: { type: string; name: string; defaultValue?: string }[] = [];
    
    // Find Property Descriptions section
    let propertyDescIndex = -1;
    for (let i = startIndex; i < lines.length; i++) {
      if (lines[i].trim() === '## Property Descriptions') {
        propertyDescIndex = i;
        break;
      }
    }
    
    if (propertyDescIndex === -1) return null;
    
    // Parse property descriptions
    for (let i = propertyDescIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Stop at next major section
      if (line.startsWith('## ') && line !== '## Property Descriptions') {
        break;
      }
      
      // Look for property declarations like: Vector2 **global_position** = `Vector2(0, 0)`
      const propertyMatch = line.match(/^(\w+(?:\d+D?)?)\s+\*\*([a-zA-Z_][a-zA-Z0-9_]*)\*\*(?:\s*=\s*`([^`]+)`)?/);
      if (propertyMatch) {
        const [, type, name, defaultValue] = propertyMatch;
        properties.push({ type, name, defaultValue });
      }
    }
    
    if (properties.length === 0) return null;
    
    // Create markdown table
    const header = '| Type | Property | Default |\n|------|----------|---------|';
    const rows = properties.map(prop => {
      const defaultVal = prop.defaultValue || '';
      return `| ${prop.type} | **${prop.name}** | ${defaultVal} |`;
    });
    
    return [header, ...rows].join('\n');
  }

  /**
   * Extract methods information and create a table
   */
  private extractMethodsTable(lines: string[], startIndex: number): string | null {
    const methods: { returnType: string; signature: string }[] = [];
    
    // Find Method Descriptions section
    let methodDescIndex = -1;
    for (let i = startIndex; i < lines.length; i++) {
      if (lines[i].trim() === '## Method Descriptions') {
        methodDescIndex = i;
        break;
      }
    }
    
    if (methodDescIndex === -1) return null;
    
    // Parse method descriptions
    for (let i = methodDescIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Stop at next major section or end
      if (line.startsWith('## ') && line !== '## Method Descriptions') {
        break;
      }
      
      // Look for method declarations like: `void (No return value.)` **apply_scale**(ratio: Vector2)
      const methodMatch = line.match(/^`([^`]+)`\s+\*\*([a-zA-Z_][a-zA-Z0-9_]*)\*\*\s*\(([^)]*)\)/);
      if (methodMatch) {
        const [, returnType, methodName, params] = methodMatch;
        const cleanReturnType = returnType.replace(/\s*\(.*?\)\s*/, '').trim() || 'void';
        const signature = `**${methodName}**(${params})`;
        methods.push({ returnType: cleanReturnType, signature });
      }
    }
    
    if (methods.length === 0) return null;
    
    // Create markdown table
    const header = '| Return Type | Method |\n|-------------|--------|';
    const rows = methods.map(method => `| ${method.returnType} | ${method.signature} |`);
    
    return [header, ...rows].join('\n');
  }

  /**
   * Remove image references from markdown content
   */
  private removeImageReferences(content: string): string {
    // Remove markdown image syntax: ![alt](src)
    content = content.replace(/!\[.*?\]\([^)]*\)/g, '');
    
    // Remove standalone image references
    content = content.replace(/\[image\]/g, '');
    
    // Remove figure/image directives that might remain
    content = content.replace(/^\s*\.\. figure::.*$/gm, '');
    content = content.replace(/^\s*\.\. image::.*$/gm, '');
    
    return content;
  }

  /**
   * Combine all converted markdown content into a single file
   */
  private combineMarkdownFiles(): void {
    const header = `# Godot Documentation - LLM Reference

This file contains the complete Godot documentation converted from RST to Markdown format.
Generated on: ${new Date().toISOString()}
Total files processed: ${this.convertedFiles.length}
Excluded directories: ${this.config.excludedDirectories.join(', ')}
Language filter: ${this.config.language}
Concurrency used: ${this.config.concurrency} workers

---

`;

    //const combinedContent = header + this.convertedFiles.join('\n\n---\n');

	const combinedContent = this.convertedFiles.join('\n\n');
    
    fs.writeFileSync(this.config.outputFile, combinedContent, 'utf8');
  }

  /**
   * Get current configuration
   */
  getConfig(): ConverterConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<ConverterConfig>): void {
    Object.assign(this.config, newConfig);
  }

  /**
   * Filter content based on language preference before pandoc conversion
   */
  private filterByLanguage(content: string): string {
    if (this.config.language === 'both') {
      return content;
    }

    const lines = content.split('\n');
    const filteredLines: string[] = [];
    let insideTabsBlock = false;
    let insideTargetCodeTab = false;
    let insideOtherCodeTab = false;
    let tabsDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Detect start of tabs block
      if (trimmed === '.. tabs::') {
        insideTabsBlock = true;
        tabsDepth = line.length - line.trimStart().length;
        filteredLines.push(line);
        continue;
      }

      // If we're inside a tabs block
      if (insideTabsBlock) {
        const currentIndent = line.length - line.trimStart().length;
        
        // Check if we've exited the tabs block (content at same or lower indentation than tabs::)
        if (trimmed.length > 0 && currentIndent <= tabsDepth && !trimmed.startsWith('..')) {
          insideTabsBlock = false;
          insideTargetCodeTab = false;
          insideOtherCodeTab = false;
          filteredLines.push(line);
          continue;
        }

        // Check for code-tab directives
        if (trimmed.startsWith('.. code-tab::')) {
          const targetLanguage = this.config.language === 'gdscript' ? 'gdscript' : 'csharp';
          
          if (trimmed.includes(targetLanguage)) {
            // This is our target language
            insideTargetCodeTab = true;
            insideOtherCodeTab = false;
            // Don't include the code-tab directive itself, just the content
            continue;
          } else {
            // This is the other language
            insideTargetCodeTab = false;
            insideOtherCodeTab = true;
            continue;
          }
        }

        // Include content if we're in the target language tab
        if (insideTargetCodeTab) {
          filteredLines.push(line);
        }
        // Skip content if we're in the other language tab
        else if (insideOtherCodeTab) {
          continue;
        }
        // Include non-code-tab content (like the tabs:: directive itself)
        else if (!trimmed.startsWith('.. code-tab::')) {
          filteredLines.push(line);
        }
      } else {
        // Not inside tabs block, include everything
        filteredLines.push(line);
      }
    }

    return filteredLines.join('\n');
  }
}

// Run the converter
if (require.main === module) {
  const converter = new GodotDocsConverter();
  
  // Load configuration from file if available
  const fileConfig = converter['loadConfigFromFile']();
  if (fileConfig) {
    converter.updateConfig(fileConfig);
  }
  
  // Example of how to customize configuration programmatically:
  // const converter = new GodotDocsConverter({
  //   excludedDirectories: ['about', 'community', 'contributing'],
  //   outputFile: './custom-llms.md',
  //   concurrency: 10
  // });

  converter.convert().catch((error) => {
    console.error('❌ Conversion failed:', error);
    process.exit(1);
  });
}
