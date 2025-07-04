package test;

import java.util.*;

public class Example {
    // Violation: returning null
    public Integer badMethod() {
        return null;
    }
    
    // Good: using Optional
    public Optional<Integer> goodMethod() {
        return Optional.empty();
    }
    
    // Violation: direct assignment
    private final List<String> items;
    public Example(List<String> items) {
        this.items = items;
        this.safeItems = null;  // Initialize safeItems
    }
    
    // Good: defensive copy
    private final List<String> safeItems;
    public Example(List<String> items, boolean safe) {
        this.items = null;  // Initialize items
        this.safeItems = new ArrayList<>(items);
    }
}public class Test { public String bad() { return null; }}
